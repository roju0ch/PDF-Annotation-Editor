mod cache;
#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
mod desktop;
mod intake;
#[cfg(all(
    any(target_os = "windows", target_os = "macos", target_os = "linux"),
    feature = "native-window-tests"
))]
mod probe;
#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux", test))]
mod routing;

use base64::{engine::general_purpose::STANDARD, Engine};
use intake::{Descriptor, Document, OpenError, Queue, Source};
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Instant,
};
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Emitter, Manager, Runtime, WebviewWindow,
};

const AVAILABLE: &str = "pdf-open-available";

#[derive(Default)]
struct Backend {
    // Entries own file handles and must be dropped before the cache directory.
    queue: Queue,
    cache: Option<cache::CacheInstance>,
    processing: bool,
    closed: bool,
}

#[derive(Clone)]
struct Session {
    label: String,
    backend: Arc<Mutex<Backend>>,
}

impl Session {
    fn new(label: &str) -> Self {
        Self {
            label: label.into(),
            backend: Arc::default(),
        }
    }

    fn close(&self) {
        if let Ok(mut backend) = self.backend.lock() {
            backend.closed = true;
            backend.queue = Queue::default();
            // An active worker retains its cache until its current bounded I/O
            // has returned and all file handles can be closed on Windows too.
            if !backend.processing {
                backend.cache = None;
            }
        }
    }
    fn push<R: Runtime>(&self, app: &AppHandle<R>, source: Source) {
        if let Ok(mut backend) = self.backend.lock() {
            if backend.closed {
                return;
            }
            backend.queue.push(source, Instant::now());
        }
        // Payloads never contain a private path, URI, or document content.
        let _ = app.emit_to(&self.label, AVAILABLE, ());
        self.kick(app);
    }

    fn kick<R: Runtime>(&self, app: &AppHandle<R>) {
        let Ok(mut backend) = self.backend.lock() else {
            return;
        };
        if backend.processing || backend.closed {
            return;
        }
        backend.processing = true;
        drop(backend);
        let queue = self.clone();
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            let result = process(&handle, &queue).await;
            if result.is_err() {
                let mut notify = false;
                if let Ok(mut backend) = queue.backend.lock() {
                    notify = backend.queue.fail_pending(OpenError::unavailable());
                    backend.processing = false;
                    if backend.closed {
                        backend.cache = None;
                    }
                }
                if notify {
                    let _ = handle.emit_to(&queue.label, AVAILABLE, ());
                }
            }
        });
    }
}

/// Created before single-instance setup, so an extremely early second launch
/// can enqueue documents before the main WebView exists. Each desktop
/// document owns a session. Mobile hands documents to the main session.
#[derive(Clone)]
pub struct PdfOpen {
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    main: Session,
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    windows: Arc<Mutex<desktop::Windows>>,
}

impl Default for PdfOpen {
    fn default() -> Self {
        let main = Session::new("main");
        Self {
            #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
            windows: Arc::new(Mutex::new(desktop::Windows::new(main))),
            #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
            main,
        }
    }
}

impl PdfOpen {
    fn session(&self, label: &str) -> Result<Session, OpenError> {
        #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
        {
            self.windows
                .lock()
                .map_err(|_| OpenError::unavailable())?
                .session(label)
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        {
            if label == "main" {
                Ok(self.main.clone())
            } else {
                Err(OpenError::invalid())
            }
        }
    }

    /// `arguments` includes argv[0], as supplied by std and the official plugin.
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    pub fn arguments<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        arguments: impl IntoIterator<Item = String>,
        cwd: &Path,
    ) {
        desktop::arguments(app, self, arguments, cwd);
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    fn urls<R: Runtime>(&self, app: &AppHandle<R>, urls: &[url::Url]) {
        #[cfg(target_os = "android")]
        let policy = intake::UrlPolicy::Android;
        #[cfg(target_os = "ios")]
        let policy = intake::UrlPolicy::Ios;
        for url in urls {
            self.main.push(app, Source::from_url(url, policy));
        }
    }
}

fn state<R: Runtime>(app: &AppHandle<R>) -> PdfOpen {
    app.state::<PdfOpen>().inner().clone()
}

async fn io<T: Send + 'static>(
    task: impl FnOnce() -> Result<T, OpenError> + Send + 'static,
) -> Result<T, OpenError> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|_| OpenError::unavailable())?
}

#[tauri::command]
async fn next_pdf_open<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<Option<Descriptor>, OpenError> {
    let state = state(&app).session(window.label())?;
    state.kick(&app);
    let guard = state.backend.lock().map_err(|_| OpenError::unavailable())?;
    Ok(guard.queue.next())
}

async fn process<R: Runtime>(app: &AppHandle<R>, state: &Session) -> Result<(), OpenError> {
    let app_cache = app
        .path()
        .app_cache_dir()
        .map_err(|_| OpenError::unavailable())?;
    loop {
        let preparing = state.clone();
        let cache_root = app_cache.clone();
        let work = io(move || {
            let mut guard = preparing
                .backend
                .lock()
                .map_err(|_| OpenError::unavailable())?;
            if guard.closed {
                guard.processing = false;
                guard.cache = None;
                return Ok(None);
            }
            if guard.cache.is_none() {
                // This serial worker owns all mobile staging. Startup cleanup
                // always finishes before a native URI reader is invoked.
                #[cfg(any(target_os = "android", target_os = "ios"))]
                intake::clean_mobile_incoming(&cache_root.join("pdf-incoming"))?;
                guard.cache = Some(
                    cache::CacheInstance::new(&cache_root.join("pdf-open"))
                        .map_err(|_| OpenError::unavailable())?,
                );
            }
            let Some(claim) = guard.queue.claim() else {
                // Release ownership while holding the same enqueue mutex:
                // a new arrival can never race an exiting worker and be lost.
                guard.processing = false;
                return Ok(None);
            };
            let directory = guard
                .cache
                .as_ref()
                .ok_or_else(OpenError::unavailable)?
                .directory()
                .to_owned();
            Ok(Some((claim, directory)))
        })
        .await?;
        let Some((claim, directory)) = work else {
            return Ok(());
        };
        let result = match claim.source {
            Ok(Source::Local(path)) => io(move || Document::stage(&path, &directory)).await,
            Ok(Source::Mobile(uri)) => {
                stage_mobile(app, uri, &claim.id, directory, app_cache.join("pdf-incoming")).await
            }
            Ok(Source::Rejected(_)) => Err(OpenError::invalid()),
            Err(error) => Err(error),
        };
        let completing = state.clone();
        io(move || {
            let mut backend = completing
                .backend
                .lock()
                .map_err(|_| OpenError::unavailable())?;
            if backend.closed {
                return Ok(());
            }
            backend.queue.complete(&claim.id, result)
        })
        .await?;
        let _ = app.emit_to(&state.label, AVAILABLE, ());
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
async fn stage_mobile<R: Runtime>(
    app: &AppHandle<R>,
    uri: String,
    _id: &str,
    directory: PathBuf,
    incoming: PathBuf,
) -> Result<Document, OpenError> {
    #[cfg(target_os = "android")]
    let staged = tauri_plugin_android_bridge::stage_incoming_pdf(app, uri).await;
    #[cfg(target_os = "ios")]
    let staged = tauri_plugin_ios_bridge::stage_incoming_pdf(app, uri, _id.to_owned()).await;
    let staged = staged.map_err(|error| OpenError::from_code(&error.code))?;
    io(move || {
        Document::adopt_mobile(
            Path::new(&staged.path),
            &incoming,
            &directory,
            &staged.file_name,
            staged.byte_length,
        )
    })
    .await
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
async fn stage_mobile<R: Runtime>(
    _app: &AppHandle<R>,
    _uri: String,
    _id: &str,
    _directory: PathBuf,
    _incoming: PathBuf,
) -> Result<Document, OpenError> {
    Err(OpenError::invalid())
}

#[derive(Serialize)]
struct Chunk {
    offset: usize,
    base64: String,
}

#[tauri::command]
async fn read_pdf_open<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    id: String,
    offset: usize,
) -> Result<Chunk, OpenError> {
    let state = state(&app).session(window.label())?;
    io(move || {
        let bytes = state
            .backend
            .lock()
            .map_err(|_| OpenError::unavailable())?
            .queue
            .read(&id, offset)?;
        Ok(Chunk {
            offset,
            base64: STANDARD.encode(bytes),
        })
    })
    .await
}

#[tauri::command]
async fn finish_pdf_open<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    id: String,
    opened: Option<bool>,
) -> Result<(), OpenError> {
    let state = state(&app).session(window.label())?;
    let waking = state.clone();
    let request_id = id.clone();
    let source = io(move || {
        state
            .backend
            .lock()
            .map_err(|_| OpenError::unavailable())?
            .queue
            .finish(&request_id, Instant::now())
    })
    .await?;
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    {
        if opened == Some(true) {
            if let Some(Source::Local(path)) = source {
                tauri_plugin_desktop_save::remember_open(&app, &window, id, path);
            }
        }
        desktop::release(&app, window.label());
    }
    #[cfg(target_os = "android")]
    if opened == Some(true) {
        if let Some(Source::Mobile(uri)) = source {
            tauri_plugin_android_bridge::remember_open(&app, id, uri);
        }
    }
    #[cfg(target_os = "ios")]
    let _ = (source, opened);
    let _ = app.emit_to(&waking.label, AVAILABLE, ());
    waking.kick(&app);
    Ok(())
}

#[cfg(target_os = "ios")]
#[tauri::command]
async fn pick_pdf_open<R: Runtime>(app: AppHandle<R>, window: WebviewWindow<R>) -> Result<(), OpenError> {
    let session = state(&app).session(window.label())?;
    let token = tauri_plugin_ios_bridge::pick_incoming_pdf(&app)
        .await
        .map_err(|error| OpenError::from_code(&error.code))?;
    if let Some(token) = token {
        // This private scheme carries a native picker token, never a JS-provided URL.
        session.push(&app, Source::Mobile(format!("picked:{token}")));
    }
    Ok(())
}

pub fn init<R: Runtime>(queue: PdfOpen) -> TauriPlugin<R> {
    let setup_queue = queue.clone();
    let builder = Builder::new("pdf-open");
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        next_pdf_open,
        read_pdf_open,
        finish_pdf_open,
        desktop::pick_pdf_open,
        desktop::new_pdf_window,
        desktop::report_window_state,
        desktop::close_pdf_window,
        desktop::cancel_window_close,
    ]);
    #[cfg(target_os = "ios")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        next_pdf_open, read_pdf_open, finish_pdf_open, pick_pdf_open
    ]);
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux", target_os = "ios")))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        next_pdf_open,
        read_pdf_open,
        finish_pdf_open
    ]);
    let builder = builder
        .setup(move |app, _| {
            app.manage(setup_queue.clone());
            #[cfg(target_os = "macos")]
            desktop::setup(app)?;
            Ok(())
        })
        .on_event(move |app, event| {
            #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
            desktop::on_event(app, &queue, event);
            #[cfg(any(target_os = "android", target_os = "ios"))]
            if let tauri::RunEvent::Opened { urls } = event {
                queue.urls(app, urls);
            }
            #[cfg(not(any(
                target_os = "windows",
                target_os = "macos",
                target_os = "linux",
                target_os = "android",
                target_os = "ios"
            )))]
            let _ = (app, event, &queue);
        });
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    let builder = builder.js_init_script("Object.defineProperty(window, '__PDF_MULTI_WINDOW__', { value: true, writable: false, configurable: false });");
    builder.build()
}

#[cfg(test)]
mod session_tests {
    use super::*;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("pdf-window-session-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn stage(&self, session: &Session, name: &str, bytes: &[u8]) -> String {
            let source = self.0.join(name);
            std::fs::write(&source, bytes).unwrap();
            let directory = self.0.join(&session.label);
            std::fs::create_dir(&directory).unwrap();
            let mut backend = session.backend.lock().unwrap();
            backend.queue.push(Source::Local(source), Instant::now());
            let claim = backend.queue.claim().unwrap();
            let document = Document::stage(
                match &claim.source {
                    Ok(Source::Local(path)) => path,
                    _ => panic!("expected file"),
                },
                &directory,
            )
            .unwrap();
            backend.queue.complete(&claim.id, Ok(document)).unwrap();
            claim.id
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn caller_sessions_cannot_read_or_acknowledge_another_windows_document() {
        let fixture = Fixture::new();
        let first = Session::new("first");
        let second = Session::new("second");
        let first_id = fixture.stage(&first, "first.pdf", b"%PDF-first");
        let second_id = fixture.stage(&second, "second.pdf", b"%PDF-second");
        {
            let mut owner = first.backend.lock().unwrap();
            assert!(owner.queue.read(&second_id, 0).is_err());
            assert!(owner.queue.finish(&second_id, Instant::now()).is_err());
            assert_eq!(owner.queue.read(&first_id, 0).unwrap(), b"%PDF-first");
        }
        let mut owner = second.backend.lock().unwrap();
        assert!(owner.queue.read(&first_id, 0).is_err());
        assert_eq!(owner.queue.read(&second_id, 0).unwrap(), b"%PDF-second");
    }

    #[test]
    fn closing_one_session_cleans_only_its_private_copy_and_other_viewer_remains_usable() {
        let fixture = Fixture::new();
        let first = Session::new("first");
        let second = Session::new("second");
        fixture.stage(&first, "first.pdf", b"%PDF-first");
        let other_id = fixture.stage(&second, "second.pdf", b"%PDF-second");
        first.close();
        assert!(first.backend.lock().unwrap().closed);
        assert!(first.backend.lock().unwrap().queue.next().is_none());
        assert_eq!(
            std::fs::read_dir(fixture.0.join("first")).unwrap().count(),
            0
        );
        let mut other = second.backend.lock().unwrap();
        assert_eq!(other.queue.read(&other_id, 0).unwrap(), b"%PDF-second");
        other.queue.finish(&other_id, Instant::now()).unwrap();
        assert_eq!(
            std::fs::read(fixture.0.join("first.pdf")).unwrap(),
            b"%PDF-first"
        );
        assert_eq!(
            std::fs::read(fixture.0.join("second.pdf")).unwrap(),
            b"%PDF-second"
        );
    }
}
