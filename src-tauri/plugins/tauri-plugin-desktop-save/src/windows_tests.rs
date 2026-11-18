use super::*;
use std::{fs, path::PathBuf};

struct Directory(PathBuf);
impl Directory {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("pdf-save-windows-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn path(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
    fn cache(&self) -> PathBuf {
        self.path("cache")
    }
}
impl Drop for Directory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn pdf(marker: u8, length: usize) -> Vec<u8> {
    let mut bytes = vec![marker; length.max(5)];
    bytes[..5].copy_from_slice(b"%PDF-");
    bytes
}
fn owner(registry: &mut Windows, label: &str) -> WindowSave {
    registry.register(label);
    registry.get(label).unwrap()
}
fn upload(owner: &WindowSave, directory: &Directory, name: &str, bytes: &[u8]) -> String {
    let token = owner
        .begin(&directory.cache(), name.to_owned(), bytes.len())
        .unwrap();
    for offset in (0..bytes.len()).step_by(storage::MAX_CHUNK_BYTES) {
        let end = (offset + storage::MAX_CHUNK_BYTES).min(bytes.len());
        assert_eq!(
            owner.append(&token, offset, &bytes[offset..end]).unwrap(),
            end
        );
    }
    assert_eq!(owner.prepare(&token).unwrap(), name);
    token
}
fn cache(owner: &WindowSave) -> PathBuf {
    owner
        .0
        .backend
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        ._cache
        .directory()
        .to_owned()
}

#[test]
fn two_windows_save_their_own_exact_bytes_independently() {
    let directory = Directory::new();
    let mut windows = Windows::default();
    let a = owner(&mut windows, "main");
    let b = owner(&mut windows, "pdf-window-b");
    let bytes_a = pdf(31, storage::MAX_CHUNK_BYTES + 17);
    let bytes_b = pdf(82, storage::MAX_CHUNK_BYTES + 29);
    let token_a = upload(&a, &directory, "Plan Süd A.pdf", &bytes_a);
    let token_b = upload(&b, &directory, "Plan B.pdf", &bytes_b);
    assert_ne!(cache(&a), cache(&b));
    assert!(a
        .finish(&token_b, Some(&directory.path("wrong-a.pdf")))
        .is_err());
    assert!(b
        .finish(&token_a, Some(&directory.path("wrong-b.pdf")))
        .is_err());
    let target_a = directory.path("Gespeicherter Plan A.pdf");
    let target_b = directory.path("Gespeicherter Plan B.pdf");
    assert_eq!(
        b.finish(&token_b, Some(&target_b)).unwrap().as_deref(),
        Some("Gespeicherter Plan B.pdf")
    );
    assert_eq!(
        a.finish(&token_a, Some(&target_a)).unwrap().as_deref(),
        Some("Gespeicherter Plan A.pdf")
    );
    assert_eq!(fs::read(target_a).unwrap(), bytes_a);
    assert_eq!(fs::read(target_b).unwrap(), bytes_b);
    assert!(!directory.path("wrong-a.pdf").exists());
    assert!(!directory.path("wrong-b.pdf").exists());
}

#[test]
fn foreign_tokens_cannot_append_or_abort_another_windows_upload() {
    let directory = Directory::new();
    let mut windows = Windows::default();
    let a = owner(&mut windows, "main");
    let b = owner(&mut windows, "pdf-window-b");
    let bytes_a = pdf(15, 100);
    let bytes_b = pdf(16, 105);
    let token_a = a
        .begin(&directory.cache(), "a.pdf".into(), bytes_a.len())
        .unwrap();
    let token_b = b
        .begin(&directory.cache(), "b.pdf".into(), bytes_b.len())
        .unwrap();
    assert!(b.append(&token_a, 0, &bytes_a).is_err());
    assert!(b.abort(&token_a).is_err());
    assert!(a.abort(&token_b).is_err());
    a.append(&token_a, 0, &bytes_a).unwrap();
    b.append(&token_b, 0, &bytes_b).unwrap();
    a.prepare(&token_a).unwrap();
    b.prepare(&token_b).unwrap();
    a.finish(&token_a, Some(&directory.path("a.pdf"))).unwrap();
    b.finish(&token_b, Some(&directory.path("b.pdf"))).unwrap();
    assert_eq!(fs::read(directory.path("a.pdf")).unwrap(), bytes_a);
    assert_eq!(fs::read(directory.path("b.pdf")).unwrap(), bytes_b);
}

#[test]
fn destroying_one_window_rejects_its_late_picker_and_preserves_the_other() {
    let directory = Directory::new();
    let mut windows = Windows::default();
    let a = owner(&mut windows, "main");
    let b = owner(&mut windows, "pdf-window-b");
    let token_a = upload(&a, &directory, "a.pdf", &pdf(11, 50));
    let bytes_b = pdf(12, 51);
    let token_b = upload(&b, &directory, "b.pdf", &bytes_b);
    let cache_a = cache(&a);
    let cache_b = cache(&b);
    let target_a = directory.path("old-a.pdf");
    fs::write(&target_a, b"previous target must survive").unwrap();
    let retired = windows.retire("main").unwrap();
    assert!(windows.get("main").is_err());
    // Retirement is already effective before the background cleanup is run.
    assert!(a.finish(&token_a, Some(&target_a)).is_err());
    assert_eq!(
        fs::read(&target_a).unwrap(),
        b"previous target must survive"
    );
    retired.cleanup();
    assert!(!cache_a.exists());
    assert!(cache_b.exists());
    b.finish(&token_b, Some(&directory.path("b.pdf"))).unwrap();
    assert_eq!(fs::read(directory.path("b.pdf")).unwrap(), bytes_b);
}

#[test]
fn a_reused_window_label_never_revives_an_old_pending_dialog() {
    let directory = Directory::new();
    let mut windows = Windows::default();
    let old = owner(&mut windows, "main");
    let old_token = upload(&old, &directory, "old.pdf", &pdf(1, 20));
    windows.retire("main").unwrap().cleanup();
    let replacement = owner(&mut windows, "main");
    let bytes = pdf(2, 24);
    let replacement_token = upload(&replacement, &directory, "new.pdf", &bytes);
    assert!(old
        .finish(&old_token, Some(&directory.path("old.pdf")))
        .is_err());
    assert!(old.abort(&replacement_token).is_err());
    assert!(replacement
        .finish(&old_token, Some(&directory.path("wrong.pdf")))
        .is_err());
    replacement
        .finish(&replacement_token, Some(&directory.path("new.pdf")))
        .unwrap();
    assert_eq!(fs::read(directory.path("new.pdf")).unwrap(), bytes);
    assert!(!directory.path("old.pdf").exists());
    assert!(!directory.path("wrong.pdf").exists());
}

#[test]
fn cancelling_one_picker_and_retrying_does_not_block_another_window() {
    let directory = Directory::new();
    let mut windows = Windows::default();
    let a = owner(&mut windows, "main");
    let b = owner(&mut windows, "pdf-window-b");
    let token_a = upload(&a, &directory, "a.pdf", &pdf(1, 20));
    let bytes_b = pdf(2, 30);
    let token_b = upload(&b, &directory, "b.pdf", &bytes_b);
    assert!(a.finish(&token_a, None).unwrap().is_none());
    let retried = pdf(3, 40);
    let retry = upload(&a, &directory, "retry.pdf", &retried);
    b.finish(&token_b, Some(&directory.path("b.pdf"))).unwrap();
    a.finish(&retry, Some(&directory.path("retry.pdf")))
        .unwrap();
    assert_eq!(fs::read(directory.path("b.pdf")).unwrap(), bytes_b);
    assert_eq!(fs::read(directory.path("retry.pdf")).unwrap(), retried);
}

#[test]
fn a_failed_destination_commit_does_not_cancel_another_windows_save() {
    let directory = Directory::new();
    let mut windows = Windows::default();
    let a = owner(&mut windows, "main");
    let b = owner(&mut windows, "pdf-window-b");
    let bytes_a = pdf(1, 30);
    let token_a = upload(&a, &directory, "a.pdf", &bytes_a);
    let token_b = upload(&b, &directory, "b.pdf", &pdf(2, 35));
    let missing = directory.path("missing/b.pdf");
    assert!(b.finish(&token_b, Some(&missing)).is_err());
    assert!(!missing.exists());
    a.finish(&token_a, Some(&directory.path("a.pdf"))).unwrap();
    assert_eq!(fs::read(directory.path("a.pdf")).unwrap(), bytes_a);
    let retry = upload(&b, &directory, "retry.pdf", &pdf(3, 50));
    b.finish(&retry, Some(&directory.path("retry.pdf")))
        .unwrap();
}

#[test]
fn queued_begin_cannot_recreate_a_closed_window_or_unknown_owner() {
    let directory = Directory::new();
    let mut windows = Windows::default();
    assert!(windows.get("invented-by-a-caller").is_err());
    let a = owner(&mut windows, "main");
    windows.retire("main").unwrap().cleanup();
    assert!(a.begin(&directory.cache(), "stale.pdf".into(), 5).is_err());
    assert!(!directory.cache().exists());
    assert!(windows.get("main").is_err());
}

#[test]
fn repeated_native_registration_keeps_the_current_upload_alive() {
    let directory = Directory::new();
    let mut windows = Windows::default();
    let a = owner(&mut windows, "main");
    let bytes = pdf(42, 73);
    let token = a
        .begin(&directory.cache(), "a.pdf".into(), bytes.len())
        .unwrap();
    windows.register("main");
    let same = windows.get("main").unwrap();
    same.append(&token, 0, &bytes).unwrap();
    same.prepare(&token).unwrap();
    same.finish(&token, Some(&directory.path("a.pdf"))).unwrap();
    assert_eq!(fs::read(directory.path("a.pdf")).unwrap(), bytes);
}
