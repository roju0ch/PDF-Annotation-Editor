use super::*;

#[test]
fn mobile_error_codes_are_normalized_without_exposing_provider_text() {
    for code in ["too-large", "too_large"] {
        let error = OpenError::from_code(code);
        assert_eq!(error.code, "too_large");
        assert_eq!(error.message, OpenError::invalid().message);
    }
    assert_eq!(OpenError::from_code("denied").code, "denied");
    let error = OpenError::from_code("provider failed at /private/document.pdf");
    assert_eq!(error.code, "unavailable");
    assert!(!error.message.contains("/private"));
}

struct Directory(PathBuf);
impl Directory {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("pdf-open-test-{}", Uuid::new_v4()));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn path(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
    fn pdf(&self, name: &str, size: usize) -> PathBuf {
        let path = self.path(name);
        let mut content = vec![42; size.max(5)];
        content[..5].copy_from_slice(b"%PDF-");
        fs::write(&path, content).unwrap();
        path
    }
}
impl Drop for Directory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn load(queue: &mut Queue, directory: &Directory) -> Descriptor {
    let claim = queue.claim().expect("expected pending source");
    let result = match claim.source {
        Ok(Source::Local(path)) => Document::stage(&path, &directory.0),
        Err(error) => Err(error),
        _ => Err(OpenError::invalid()),
    };
    queue.complete(&claim.id, result).unwrap();
    queue.next().expect("expected ready descriptor")
}

#[test]
fn os_paths_and_file_urls_preserve_spaces_unicode_and_percent_characters() {
    let directory = Directory::new();
    let path = directory.pdf("Plan Süd #1 50%.pdf", 32);
    let absolute = Source::from_argument(path.to_str().unwrap(), &directory.0);
    let relative = Source::from_argument("./Plan Süd #1 50%.pdf", &directory.0);
    let uri = Url::from_file_path(&path).unwrap();
    assert_eq!(absolute, relative);
    assert_eq!(absolute, Source::from_url(&uri, UrlPolicy::Desktop));
    assert!(uri.as_str().contains("%20"));
    assert!(uri.as_str().contains("%25"));
    assert_eq!(
        Source::from_argument("literal%20name.pdf", &directory.0),
        Source::Local(directory.path("literal%20name.pdf"))
    );
}

#[test]
fn relative_paths_resolve_against_the_launching_process_directory() {
    let directory = Directory::new();
    assert_eq!(
        Source::from_argument("sub/../Plan.pdf", &directory.0),
        Source::Local(directory.path("Plan.pdf"))
    );
    assert_eq!(
        Source::from_argument("file:///tmp/Plan%20A.pdf", &directory.0),
        Source::from_url(
            &Url::parse("file:///tmp/Plan%20A.pdf").unwrap(),
            UrlPolicy::Desktop
        )
    );
}

#[test]
fn only_local_file_urls_and_android_content_urls_are_accepted() {
    for uri in [
        "https://example.invalid/a.pdf",
        "ftp://example.invalid/a.pdf",
        "data:application/pdf,abc",
        "file:///tmp/a.pdf?download=1",
        "file:///tmp/a.pdf#page=2",
    ] {
        for policy in [UrlPolicy::Desktop, UrlPolicy::Android, UrlPolicy::Ios] {
            assert!(matches!(
                Source::from_url(&Url::parse(uri).unwrap(), policy),
                Source::Rejected(_)
            ));
        }
    }
    let content = Url::parse("content://downloads/document/42?key=one").unwrap();
    assert!(matches!(
        Source::from_url(&content, UrlPolicy::Android),
        Source::Mobile(_)
    ));
    assert!(matches!(
        Source::from_url(&content, UrlPolicy::Desktop),
        Source::Rejected(_)
    ));
    assert!(matches!(
        Source::from_url(&content, UrlPolicy::Ios),
        Source::Rejected(_)
    ));
    let directory = Directory::new();
    let file = Url::from_file_path(directory.path("Plan Süd.pdf")).unwrap();
    assert!(matches!(
        Source::from_url(&file, UrlPolicy::Ios),
        Source::Mobile(_)
    ));
    assert!(matches!(
        Source::from_url(&file, UrlPolicy::Android),
        Source::Mobile(_)
    ));
    assert!(matches!(
        Source::from_url(
            &Url::parse("file://remote.invalid/Plan.pdf").unwrap(),
            UrlPolicy::Ios
        ),
        Source::Rejected(_)
    ));
}

#[test]
fn startup_queue_survives_missing_frontend_and_loading_is_single_owner() {
    let directory = Directory::new();
    let source = Source::Local(directory.pdf("cold.pdf", 32));
    let mut queue = Queue::default();
    queue.push(source.clone(), Instant::now());
    assert!(queue.next().is_none());
    let Claim { id, source: actual } = queue.claim().unwrap();
    assert_eq!(actual.unwrap(), source);
    assert!(queue.claim().is_none());
    assert!(queue.next().is_none());
    queue
        .complete(
            &id,
            Document::stage(&directory.path("cold.pdf"), &directory.0),
        )
        .unwrap();
    for _ in 0..3 {
        let descriptor = queue.next().unwrap();
        assert_eq!(descriptor.id, id);
        assert_eq!(descriptor.file_name.as_deref(), Some("cold.pdf"));
        assert_eq!(descriptor.byte_length, Some(32));
        assert!(descriptor.error.is_none());
    }
    queue.finish(&id, Instant::now()).unwrap();
    assert!(queue.next().is_none());
}

#[test]
fn duplicate_delivery_is_suppressed_but_later_explicit_reopening_is_allowed() {
    let directory = Directory::new();
    let source = Source::Local(directory.pdf("same.pdf", 32));
    let now = Instant::now();
    let mut queue = Queue::default();
    queue.push(source.clone(), now);
    queue.push(source.clone(), now);
    let descriptor = load(&mut queue, &directory);
    queue.push(source.clone(), now);
    assert_eq!(queue.entries.len(), 1);
    queue.finish(&descriptor.id, now).unwrap();
    queue.push(source.clone(), now + Duration::from_secs(1));
    assert!(queue.next().is_none());
    queue.push(source, now + Duration::from_secs(3));
    assert!(queue.claim().is_some());
}

#[test]
fn another_pdf_waits_until_the_current_request_is_acknowledged() {
    let directory = Directory::new();
    let mut queue = Queue::default();
    queue.push(
        Source::Local(directory.pdf("first.pdf", 40)),
        Instant::now(),
    );
    queue.push(
        Source::Local(directory.pdf("second.pdf", 80)),
        Instant::now(),
    );
    let first = load(&mut queue, &directory);
    assert_eq!(first.file_name.as_deref(), Some("first.pdf"));
    assert!(queue
        .finish(&Uuid::new_v4().to_string(), Instant::now())
        .is_err());
    assert!(queue.read(&Uuid::new_v4().to_string(), 0).is_err());
    queue.finish(&first.id, Instant::now()).unwrap();
    let second = load(&mut queue, &directory);
    assert_ne!(first.id, second.id);
    assert_eq!(second.file_name.as_deref(), Some("second.pdf"));
    queue.finish(&second.id, Instant::now()).unwrap();
}

#[test]
fn reads_exact_chunks_and_can_rewind_after_frontend_remount() {
    let directory = Directory::new();
    let input = directory.pdf("large.pdf", CHUNK_BYTES * 2 + 123);
    let expected = fs::read(&input).unwrap();
    let mut queue = Queue::default();
    queue.push(Source::Local(input), Instant::now());
    let descriptor = load(&mut queue, &directory);
    let first = queue.read(&descriptor.id, 0).unwrap();
    assert_eq!(first.len(), CHUNK_BYTES);
    assert_eq!(first, queue.read(&descriptor.id, 0).unwrap());
    let mut bytes = first;
    bytes.extend(queue.read(&descriptor.id, CHUNK_BYTES).unwrap());
    let last = queue.read(&descriptor.id, CHUNK_BYTES * 2).unwrap();
    assert_eq!(last.len(), 123);
    bytes.extend(last);
    assert_eq!(bytes, expected);
    assert!(queue.read(&descriptor.id, 1).is_err());
    assert!(queue.read(&descriptor.id, CHUNK_BYTES * 3).is_err());
    queue.finish(&descriptor.id, Instant::now()).unwrap();
    assert!(queue.read(&descriptor.id, 0).is_err());
}

#[test]
fn a_staged_pdf_is_stable_when_the_source_changes_and_cleanup_keeps_original() {
    let directory = Directory::new();
    let input = directory.pdf("source.pdf", 40);
    let expected = fs::read(&input).unwrap();
    let mut document = Document::stage(&input, &directory.0).unwrap();
    let private = document.path.clone();
    fs::write(&input, b"changed by another application").unwrap();
    assert_eq!(document.read(0).unwrap(), expected);
    drop(document);
    assert!(!private.exists());
    assert_eq!(fs::read(input).unwrap(), b"changed by another application");
}

#[test]
fn invalid_headers_empty_files_directories_and_oversized_files_fail_before_import() {
    let directory = Directory::new();
    for (name, contents) in [
        ("empty.pdf", b"".as_slice()),
        ("invalid.pdf", b"not a PDF".as_slice()),
    ] {
        let input = directory.path(name);
        fs::write(&input, contents).unwrap();
        assert_eq!(
            Document::stage(&input, &directory.0).err().unwrap().code,
            "invalid"
        );
    }
    assert_eq!(
        Document::stage(&directory.0, &directory.0)
            .err()
            .unwrap()
            .code,
        "invalid"
    );
    let huge = directory.pdf("oversized.pdf", 5);
    OpenOptions::new()
        .write(true)
        .open(&huge)
        .unwrap()
        .set_len(MAX_PDF_BYTES as u64 + 1)
        .unwrap();
    assert_eq!(
        Document::stage(&huge, &directory.0).err().unwrap().code,
        "too_large"
    );
}

#[test]
fn accepts_pdf_header_inside_the_same_first_1024_bytes_as_the_shared_importer() {
    let directory = Directory::new();
    let mut data = vec![b' '; 1019];
    data.extend(b"%PDF-1.7");
    fs::write(directory.path("preamble.pdf"), &data).unwrap();
    let document = Document::stage(&directory.path("preamble.pdf"), &directory.0).unwrap();
    assert_eq!(document.byte_length, data.len());
    drop(document);
    data.insert(0, b' ');
    fs::write(directory.path("preamble.pdf"), &data).unwrap();
    assert!(Document::stage(&directory.path("preamble.pdf"), &directory.0).is_err());
}

#[test]
fn an_unreadable_source_becomes_an_acknowledgeable_error_without_paths() {
    let directory = Directory::new();
    let secret = directory.path("private-personal-document.pdf");
    let mut queue = Queue::default();
    queue.push(Source::Local(secret.clone()), Instant::now());
    let descriptor = load(&mut queue, &directory);
    assert_eq!(descriptor.error.unwrap().code, "unavailable");
    assert!(descriptor.file_name.is_none());
    assert!(descriptor.byte_length.is_none());
    assert!(!OpenError::unavailable()
        .message
        .contains(secret.to_str().unwrap()));
    assert!(queue.read(&descriptor.id, 0).is_err());
    queue.finish(&descriptor.id, Instant::now()).unwrap();
    assert!(queue.next().is_none());
}

#[test]
fn pending_request_cannot_be_acknowledged_or_replaced_during_staging() {
    let directory = Directory::new();
    let mut queue = Queue::default();
    queue.push(
        Source::Local(directory.pdf("pending.pdf", 20)),
        Instant::now(),
    );
    let id = queue.entries.front().unwrap().id.clone();
    assert!(queue.finish(&id, Instant::now()).is_err());
    assert!(queue.claim().is_some());
    assert!(queue.finish(&id, Instant::now()).is_err());
    assert!(queue.complete("wrong", Err(OpenError::invalid())).is_err());
    queue.complete(&id, Err(OpenError::invalid())).unwrap();
    queue.finish(&id, Instant::now()).unwrap();
}

#[test]
fn overflow_is_bounded_and_reported_once_after_existing_requests() {
    let mut queue = Queue::default();
    for index in 0..MAX_PENDING + 10 {
        queue.push(Source::Rejected(format!("{index}")), Instant::now());
    }
    assert_eq!(queue.entries.len(), MAX_PENDING);
    let mut errors = 0;
    while !queue.entries.is_empty() {
        if let Some(claim) = queue.claim() {
            queue
                .complete(&claim.id, Err(claim.source.err().unwrap()))
                .unwrap();
        }
        let descriptor = queue.next().unwrap();
        if descriptor.error.unwrap().code == "queue_full" {
            errors += 1;
        }
        queue.finish(&descriptor.id, Instant::now()).unwrap();
    }
    assert_eq!(errors, 1);
}

#[test]
fn mobile_staging_accepts_only_owned_confined_regular_copies_and_matching_length() {
    let root = Directory::new();
    let incoming = root.path("incoming");
    let cache = root.path("cache");
    fs::create_dir(&incoming).unwrap();
    fs::create_dir(&cache).unwrap();
    let path = incoming.join(format!("pdf-incoming-{}.tmp", Uuid::new_v4()));
    fs::write(&path, b"%PDF-1.7").unwrap();
    let mut document = Document::adopt_mobile(&path, &incoming, &cache, "Plan Süd.pdf", 8).unwrap();
    assert!(!path.exists());
    assert_eq!(document.file_name, "Plan Süd.pdf");
    assert_eq!(document.read(0).unwrap(), b"%PDF-1.7");
    let owned = document.path.clone();
    drop(document);
    assert!(!owned.exists());
    let denied = root.pdf("not-owned.pdf", 12);
    assert!(Document::adopt_mobile(&denied, &incoming, &cache, "a.pdf", 12).is_err());
    assert!(denied.exists());
    let path = incoming.join("pdf-incoming-1234567890.tmp");
    fs::write(&path, b"%PDF-1.7").unwrap();
    assert!(Document::adopt_mobile(&path, &incoming, &cache, "a.pdf", 7).is_err());
    assert!(!path.exists());
}

#[test]
fn mobile_startup_cleanup_preserves_unowned_names_and_directories() {
    let root = Directory::new();
    let owned = root.path(&format!("pdf-incoming-{}.tmp", Uuid::new_v4()));
    let java_owned = root.path("pdf-incoming-1234567890123.tmp");
    let unowned = root.path("other-private-file.tmp");
    let directory = root.path("pdf-incoming-1234567890.tmp");
    for path in [&owned, &java_owned, &unowned] {
        fs::write(path, b"test").unwrap();
    }
    fs::create_dir(&directory).unwrap();
    clean_mobile_incoming(&root.0).unwrap();
    assert!(!owned.exists());
    assert!(!java_owned.exists());
    assert!(unowned.exists());
    assert!(directory.exists());
}

#[cfg(unix)]
#[test]
fn private_cache_is_not_world_readable_and_mobile_symlinks_are_never_adopted() {
    use std::os::unix::{fs::symlink, fs::PermissionsExt};
    let root = Directory::new();
    let source = root.pdf("source.pdf", 12);
    let document = Document::stage(&source, &root.0).unwrap();
    assert_eq!(
        fs::metadata(&document.path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    let symlink_path = root.path(&format!("pdf-incoming-{}.tmp", Uuid::new_v4()));
    symlink(&source, &symlink_path).unwrap();
    assert!(Document::adopt_mobile(&symlink_path, &root.0, &root.0, "a.pdf", 12).is_err());
    clean_mobile_incoming(&root.0).unwrap();
    assert!(symlink_path.symlink_metadata().is_ok());
    assert!(source.exists());
}

#[test]
fn truncated_cache_read_returns_an_error_instead_of_a_short_successful_chunk() {
    let root = Directory::new();
    let input = root.pdf("a.pdf", CHUNK_BYTES + 10);
    let mut document = Document::stage(&input, &root.0).unwrap();
    OpenOptions::new()
        .write(true)
        .open(&document.path)
        .unwrap()
        .set_len(5)
        .unwrap();
    assert!(document.read(0).is_err());
}

#[test]
fn a_serial_worker_can_snapshot_multiple_grants_before_frontend_startup() {
    let root = Directory::new();
    let mut queue = Queue::default();
    let first = Source::Mobile("content://provider/first".into());
    let second = Source::Mobile("content://provider/second".into());
    queue.push(first.clone(), Instant::now());
    queue.push(second.clone(), Instant::now());
    let one = queue.claim().unwrap();
    assert_eq!(one.source.unwrap(), first);
    assert!(queue.claim().is_none()); // No second provider reader in flight.
    queue
        .complete(
            &one.id,
            Document::stage(&root.pdf("first.pdf", 40), &root.0),
        )
        .unwrap();
    let two = queue.claim().unwrap();
    assert_eq!(two.source.unwrap(), second);
    assert!(queue.claim().is_none());
    queue
        .complete(
            &two.id,
            Document::stage(&root.pdf("second.pdf", 50), &root.0),
        )
        .unwrap();
    // React has not called next() once; both private copies already exist.
    assert!(queue.claim().is_none());
    let head = queue.next().unwrap();
    assert_eq!(head.id, one.id);
    assert!(queue.read(&two.id, 0).is_err()); // Later grants never bypass FIFO.
    assert!(queue.finish(&two.id, Instant::now()).is_err());
    queue.finish(&one.id, Instant::now()).unwrap();
    assert_eq!(queue.next().unwrap().id, two.id);
    assert_eq!(queue.read(&two.id, 0).unwrap().len(), 50);
    queue.finish(&two.id, Instant::now()).unwrap();
}

#[test]
fn aggregate_cache_budget_rejects_extra_grants_before_opening_their_provider() {
    let root = Directory::new();
    let input = root.pdf("large.pdf", 5);
    OpenOptions::new()
        .write(true)
        .open(&input)
        .unwrap()
        .set_len(MAX_PDF_BYTES as u64)
        .unwrap();
    let mut queue = Queue::default();
    for name in ["one", "two", "three"] {
        queue.push(
            Source::Mobile(format!("content://provider/{name}")),
            Instant::now(),
        );
    }
    let one = queue.claim().unwrap();
    assert!(one.source.is_ok());
    let first = Document::stage(&input, &root.0).unwrap();
    let first_cache = first.path.clone();
    queue.complete(&one.id, Ok(first)).unwrap();
    let two = queue.claim().unwrap();
    assert!(two.source.is_ok());
    let second = Document::stage(&input, &root.0).unwrap();
    let second_cache = second.path.clone();
    queue.complete(&two.id, Ok(second)).unwrap();
    let three = queue.claim().unwrap();
    assert_eq!(three.source.unwrap_err().code, "queue_full");
    queue
        .complete(&three.id, Err(OpenError::queue_full()))
        .unwrap();
    assert_eq!(
        fs::metadata(&first_cache).unwrap().len() + fs::metadata(&second_cache).unwrap().len(),
        MAX_STAGED_BYTES as u64
    );
    queue.finish(&one.id, Instant::now()).unwrap();
    assert!(!first_cache.exists());
    queue.finish(&two.id, Instant::now()).unwrap();
    assert!(!second_cache.exists());
    assert_eq!(queue.next().unwrap().error.unwrap().code, "queue_full");
    queue.finish(&three.id, Instant::now()).unwrap();
    assert!(queue.next().is_none());
}

#[test]
fn fatal_worker_failure_is_acknowledgeable_and_preserves_already_staged_documents() {
    let root = Directory::new();
    let mut queue = Queue::default();
    queue.push(Source::Local(root.pdf("ready.pdf", 20)), Instant::now());
    let ready = load(&mut queue, &root);
    queue.push(
        Source::Mobile("content://provider/pending".into()),
        Instant::now(),
    );
    queue.push(
        Source::Mobile("content://provider/queued".into()),
        Instant::now(),
    );
    assert!(queue.claim().is_some());
    assert!(queue.fail_pending(OpenError::unavailable()));
    assert!(!queue.fail_pending(OpenError::unavailable()));
    assert_eq!(queue.read(&ready.id, 0).unwrap().len(), 20);
    queue.finish(&ready.id, Instant::now()).unwrap();
    for _ in 0..2 {
        let error = queue.next().unwrap();
        assert_eq!(error.error.unwrap().code, "unavailable");
        queue.finish(&error.id, Instant::now()).unwrap();
    }
    assert!(queue.next().is_none());
}
