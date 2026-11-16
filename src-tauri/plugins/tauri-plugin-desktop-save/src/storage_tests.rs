use super::*;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const TOKEN: &str = "00000000-0000-4000-8000-000000000001";
const OTHER: &str = "00000000-0000-4000-8000-000000000002";
static NEXT: AtomicU64 = AtomicU64::new(0);

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new() -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "pdf-editor-storage-test-{}-{}-{}",
            std::process::id(),
            now,
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        Self(root)
    }

    fn cache(&self) -> PathBuf {
        self.0.join("cache")
    }
    fn output(&self) -> PathBuf {
        let path = self.0.join("output");
        fs::create_dir_all(&path).unwrap();
        path
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn names(directory: &Path) -> Vec<String> {
    let mut result: Vec<_> = fs::read_dir(directory)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    result.sort();
    result
}

fn pdf(size: usize) -> Vec<u8> {
    let mut bytes = (0..size)
        .map(|index| (index % 251) as u8)
        .collect::<Vec<_>>();
    bytes[..5].copy_from_slice(b"%PDF-");
    bytes
}

fn stage(sessions: &mut Sessions, token: &str, bytes: &[u8]) {
    sessions
        .begin(token.into(), "Plan-annotiert.pdf".into(), bytes.len())
        .unwrap();
    for (index, chunk) in bytes.chunks(MAX_CHUNK_BYTES).enumerate() {
        let offset = index * MAX_CHUNK_BYTES;
        assert_eq!(
            sessions.append(token, offset, chunk).unwrap(),
            offset + chunk.len()
        );
    }
    assert_eq!(sessions.prepare(token).unwrap(), "Plan-annotiert.pdf");
}

#[test]
fn writes_exact_multi_chunk_bytes_and_returns_only_the_selected_basename() {
    let dir = TestDirectory::new();
    let mut sessions = Sessions::new(dir.cache()).unwrap();
    let bytes = pdf(MAX_CHUNK_BYTES * 2 + 71);
    let target = dir.output().join("Geprüfter Plan.pdf");
    stage(&mut sessions, TOKEN, &bytes);
    assert!(
        !target.exists(),
        "staging must never write an unchosen destination"
    );
    assert_eq!(
        sessions.finish(TOKEN, Some(&target)).unwrap(),
        Some("Geprüfter Plan.pdf".into())
    );
    assert_eq!(fs::read(&target).unwrap(), bytes);
    assert!(names(&dir.cache()).is_empty());
    assert_eq!(names(&dir.output()), ["Geprüfter Plan.pdf"]);
}

#[test]
fn a_confirmed_target_is_replaced_by_the_complete_verified_file() {
    let dir = TestDirectory::new();
    let mut sessions = Sessions::new(dir.cache()).unwrap();
    let target = dir.output().join("Existing.pdf");
    let old = b"Original file must survive until the selected commit";
    fs::write(&target, old).unwrap();
    let bytes = pdf(4097);
    stage(&mut sessions, TOKEN, &bytes);
    assert_eq!(fs::read(&target).unwrap(), old);
    assert_eq!(
        sessions.finish(TOKEN, Some(&target)).unwrap(),
        Some("Existing.pdf".into())
    );
    assert_eq!(fs::read(&target).unwrap(), bytes);
    assert_eq!(names(&dir.output()), ["Existing.pdf"]);
    assert!(names(&dir.cache()).is_empty());
}

#[test]
fn cancelling_the_dialog_does_not_touch_a_file_and_releases_the_session() {
    let dir = TestDirectory::new();
    let mut sessions = Sessions::new(dir.cache()).unwrap();
    let target = dir.output().join("Existing.pdf");
    fs::write(&target, b"original").unwrap();
    let bytes = pdf(31);
    stage(&mut sessions, TOKEN, &bytes);
    assert_eq!(sessions.finish(TOKEN, None).unwrap(), None);
    assert_eq!(fs::read(&target).unwrap(), b"original");
    assert!(names(&dir.cache()).is_empty());
    stage(&mut sessions, OTHER, &bytes);
    assert_eq!(sessions.finish(OTHER, None).unwrap(), None);
}

#[test]
fn unknown_tokens_cannot_modify_abort_or_finish_another_upload() {
    let dir = TestDirectory::new();
    let mut sessions = Sessions::new(dir.cache()).unwrap();
    let bytes = pdf(43);
    sessions
        .begin(TOKEN.into(), "Plan.pdf".into(), bytes.len())
        .unwrap();
    assert!(sessions.append(OTHER, 0, &bytes).is_err());
    assert!(sessions.abort(OTHER).is_err());
    assert_eq!(sessions.append(TOKEN, 0, &bytes).unwrap(), bytes.len());
    sessions.prepare(TOKEN).unwrap();
    assert!(sessions.finish(OTHER, None).is_err());
    let target = dir.output().join("Plan.pdf");
    sessions.finish(TOKEN, Some(&target)).unwrap();
    assert_eq!(fs::read(target).unwrap(), bytes);
}

#[test]
fn invalid_offsets_empty_chunks_and_overflow_discard_only_their_own_upload() {
    let dir = TestDirectory::new();
    let mut sessions = Sessions::new(dir.cache()).unwrap();
    for (offset, chunk) in [
        (1, &b"%PDF-"[..]),
        (usize::MAX, &b"%PDF-"[..]),
        (0, &b""[..]),
        (0, &b"%PDF-too-long"[..]),
    ] {
        sessions.begin(TOKEN.into(), "Plan.pdf".into(), 5).unwrap();
        assert!(sessions.append(TOKEN, offset, chunk).is_err());
        assert!(names(&dir.cache()).is_empty());
        sessions.abort(TOKEN).unwrap();
    }
    sessions
        .begin(TOKEN.into(), "Plan.pdf".into(), MAX_CHUNK_BYTES + 1)
        .unwrap();
    assert!(sessions
        .append(TOKEN, 0, &pdf(MAX_CHUNK_BYTES + 1))
        .is_err());
    assert!(names(&dir.cache()).is_empty());
}

#[test]
fn rejected_header_and_incomplete_pdf_cannot_reach_the_picker() {
    let dir = TestDirectory::new();
    let mut sessions = Sessions::new(dir.cache()).unwrap();
    sessions.begin(TOKEN.into(), "Plan.pdf".into(), 9).unwrap();
    sessions.append(TOKEN, 0, b"not-a-pdf").unwrap();
    assert!(sessions.prepare(TOKEN).is_err());
    assert!(names(&dir.cache()).is_empty());
    sessions.begin(TOKEN.into(), "Plan.pdf".into(), 10).unwrap();
    sessions.append(TOKEN, 0, b"%PDF-").unwrap();
    assert!(sessions.prepare(TOKEN).is_err());
    assert!(names(&dir.cache()).is_empty());
}

#[test]
fn size_limits_and_single_transaction_are_enforced_without_large_allocations() {
    let dir = TestDirectory::new();
    let mut sessions = Sessions::new(dir.cache()).unwrap();
    assert!(sessions.begin(TOKEN.into(), "Plan.pdf".into(), 4).is_err());
    assert!(sessions
        .begin(TOKEN.into(), "Plan.pdf".into(), MAX_PDF_BYTES + 1)
        .is_err());
    sessions.begin(TOKEN.into(), "Plan.pdf".into(), 5).unwrap();
    assert!(sessions.begin(OTHER.into(), "Other.pdf".into(), 5).is_err());
    assert_eq!(names(&dir.cache()).len(), 1);
    sessions.abort(TOKEN).unwrap();
    assert!(names(&dir.cache()).is_empty());
}

#[test]
fn invalid_file_names_and_tokens_never_create_staging_paths() {
    let dir = TestDirectory::new();
    let mut sessions = Sessions::new(dir.cache()).unwrap();
    for name in [
        "",
        "   ",
        "../outside.pdf",
        "folder\\outside.pdf",
        "bad\0name.pdf",
    ] {
        assert!(sessions.begin(TOKEN.into(), name.into(), 5).is_err());
        assert!(names(&dir.cache()).is_empty());
    }
    for token in ["", "../outside", "00000000-0000-4000-8000-00000000000z"] {
        assert!(sessions.begin(token.into(), "Plan.pdf".into(), 5).is_err());
        assert!(names(&dir.cache()).is_empty());
    }
    sessions
        .begin(TOKEN.into(), "Prüfung 日本語.pdf".into(), 5)
        .unwrap();
    sessions.abort(TOKEN).unwrap();
    assert!(names(&dir.cache()).is_empty());
}

#[test]
fn failed_commit_keeps_the_old_destination_and_removes_both_owned_temporaries() {
    let dir = TestDirectory::new();
    let mut sessions = Sessions::new(dir.cache()).unwrap();
    let output = dir.output();
    let target = output.join("Existing.pdf");
    fs::create_dir(&target).unwrap();
    fs::write(target.join("original"), b"must remain untouched").unwrap();
    stage(&mut sessions, TOKEN, &pdf(125));
    assert!(sessions.finish(TOKEN, Some(&target)).is_err());
    assert_eq!(
        fs::read(target.join("original")).unwrap(),
        b"must remain untouched"
    );
    assert_eq!(names(&output), ["Existing.pdf"]);
    assert!(names(&dir.cache()).is_empty());
    let retry = output.join("Retry.pdf");
    let bytes = pdf(92);
    stage(&mut sessions, OTHER, &bytes);
    sessions.finish(OTHER, Some(&retry)).unwrap();
    assert_eq!(fs::read(retry).unwrap(), bytes);
}

#[test]
fn a_preexisting_temporary_collision_is_not_deleted_or_overwritten() {
    let dir = TestDirectory::new();
    let mut sessions = Sessions::new(dir.cache()).unwrap();
    let output = dir.output();
    let target = output.join("Existing.pdf");
    let collision = output.join(format!(".pdf-save-{TOKEN}.tmp"));
    fs::write(&target, b"old destination").unwrap();
    fs::write(&collision, b"another owner's temporary").unwrap();
    stage(&mut sessions, TOKEN, &pdf(130));
    assert!(sessions.finish(TOKEN, Some(&target)).is_err());
    assert_eq!(fs::read(target).unwrap(), b"old destination");
    assert_eq!(fs::read(collision).unwrap(), b"another owner's temporary");
    assert!(names(&dir.cache()).is_empty());
}

#[test]
fn aborting_an_open_picker_cannot_be_replaced_by_an_unrelated_transaction() {
    let dir = TestDirectory::new();
    let mut sessions = Sessions::new(dir.cache()).unwrap();
    let bytes = pdf(27);
    stage(&mut sessions, TOKEN, &bytes);
    sessions.abort(TOKEN).unwrap();
    assert!(sessions
        .begin(OTHER.into(), "Other.pdf".into(), bytes.len())
        .is_err());
    let target = dir.output().join("Cancelled.pdf");
    assert_eq!(sessions.finish(TOKEN, Some(&target)).unwrap(), None);
    assert!(!target.exists());
    assert!(names(&dir.cache()).is_empty());
    stage(&mut sessions, OTHER, &bytes);
    assert_eq!(sessions.finish(OTHER, None).unwrap(), None);
}

#[test]
fn startup_cleanup_only_removes_owned_regular_staging_files() {
    let dir = TestDirectory::new();
    let cache = dir.cache();
    fs::create_dir(&cache).unwrap();
    fs::write(
        cache.join("pdf-export-old.tmp"),
        b"orphaned private test PDF",
    )
    .unwrap();
    fs::write(cache.join("unrelated.txt"), b"not ours").unwrap();
    fs::create_dir(cache.join("pdf-export-directory")).unwrap();
    let sessions = Sessions::new(cache.clone()).unwrap();
    assert_eq!(names(&cache), ["pdf-export-directory", "unrelated.txt"]);
    drop(sessions);
    assert_eq!(fs::read(cache.join("unrelated.txt")).unwrap(), b"not ours");
}
