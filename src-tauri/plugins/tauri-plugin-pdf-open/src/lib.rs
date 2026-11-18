mod cache;
mod intake;

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
    AppHandle, Emitter, Manager, Runtime,
};

const AVAILABLE: &str = "pdf-open-available";

#[derive(Default)]
struct Backend {
    // Entries own file handles and must be dropped before the cache directory.
    queue: Queue,
    cache: Option<cache::CacheInstance>,
    processing: bool,
}

/// Created before single-instance setup, so an extremely early second launch
/// can already enqueue its documents before the main WebView exists.
#[derive(Clone, Default)]
pub struct PdfOpen(Arc<Mutex<Backend>>);

impl PdfOpen {
    fn push<R: Runtime>(&self, app: &AppHandle<R>, source: Source) {
        if let Ok(mut backend) = self.0.lock() {
            backend.queue.push(source, Instant::now());
        }
        // Payloads never contain a private path, URI, or document content.
        let _ = app.emit_to("main", AVAILABLE, ());
        self.kick(app);
    }

    fn kick<R: Runtime>(&self, app: &AppHandle<R>) {
        let Ok(mut backend) = self.0.lock() else {
            return;
        };
        if backend.processing {
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
                if let Ok(mut backend) = queue.0.lock() {
                    notify = backend.queue.fail_pending(OpenError::unavailable());
                    backend.processing = false;
                }
                if notify {
                    let _ = handle.emit_to("main", AVAILABLE, ());
                }
            }
        });
    }

    /// `arguments` includes argv[0], as supplied by std and the official plugin.
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    pub fn arguments<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        arguments: impl IntoIterator<Item = String>,
        cwd: &Path,
    ) {
        let mut positional = false;
        for argument in arguments.into_iter().skip(1) {
            if !positional && argument == "--" {
                positional = true;
                continue;
            }
            if !positional && argument.starts_with('-') {
                continue;
            }
            self.push(app, Source::from_argument(&argument, cwd));
        }
    }

    #[cfg(any(target_os = "macos", target_os = "android", target_os = "ios"))]
    fn urls<R: Runtime>(&self, app: &AppHandle<R>, urls: &[url::Url]) {
        #[cfg(target_os = "macos")]
        let policy = intake::UrlPolicy::Desktop;
        #[cfg(target_os = "android")]
        let policy = intake::UrlPolicy::Android;
        #[cfg(target_os = "ios")]
        let policy = intake::UrlPolicy::Ios;
        for url in urls {
            self.push(app, Source::from_url(url, policy));
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
async fn next_pdf_open<R: Runtime>(app: AppHandle<R>) -> Result<Option<Descriptor>, OpenError> {
    let state = state(&app);
    state.kick(&app);
    let guard = state.0.lock().map_err(|_| OpenError::unavailable())?;
    Ok(guard.queue.next())
}

async fn process<R: Runtime>(app: &AppHandle<R>, state: &PdfOpen) -> Result<(), OpenError> {
    let app_cache = app
        .path()
        .app_cache_dir()
        .map_err(|_| OpenError::unavailable())?;
    loop {
        let preparing = state.clone();
        let cache_root = app_cache.clone();
        let work = io(move || {
            let mut guard = preparing.0.lock().map_err(|_| OpenError::unavailable())?;
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
                stage_mobile(app, uri, directory, app_cache.join("pdf-incoming")).await
            }
            Ok(Source::Rejected(_)) => Err(OpenError::invalid()),
            Err(error) => Err(error),
        };
        let completing = state.clone();
        io(move || {
            completing
                .0
                .lock()
                .map_err(|_| OpenError::unavailable())?
                .queue
                .complete(&claim.id, result)
        })
        .await?;
        let _ = app.emit_to("main", AVAILABLE, ());
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
async fn stage_mobile<R: Runtime>(
    app: &AppHandle<R>,
    uri: String,
    directory: PathBuf,
    incoming: PathBuf,
) -> Result<Document, OpenError> {
    #[cfg(target_os = "android")]
    let staged = tauri_plugin_android_bridge::stage_incoming_pdf(app, uri).await;
    #[cfg(target_os = "ios")]
    let staged = tauri_plugin_ios_bridge::stage_incoming_pdf(app, uri).await;
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
    id: String,
    offset: usize,
) -> Result<Chunk, OpenError> {
    let state = state(&app);
    io(move || {
        let bytes = state
            .0
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
async fn finish_pdf_open<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), OpenError> {
    let state = state(&app);
    let waking = state.clone();
    io(move || {
        state
            .0
            .lock()
            .map_err(|_| OpenError::unavailable())?
            .queue
            .finish(&id, Instant::now())
    })
    .await?;
    let _ = app.emit_to("main", AVAILABLE, ());
    waking.kick(&app);
    Ok(())
}

pub fn init<R: Runtime>(queue: PdfOpen) -> TauriPlugin<R> {
    let setup_queue = queue.clone();
    let builder = Builder::new("pdf-open")
        .invoke_handler(tauri::generate_handler![
            next_pdf_open,
            read_pdf_open,
            finish_pdf_open
        ])
        .setup(move |app, _| {
            app.manage(setup_queue.clone());
            #[cfg(any(target_os = "windows", target_os = "linux"))]
            setup_queue.arguments(
                app,
                std::env::args_os().map(|arg| arg.to_string_lossy().into_owned()),
                &std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
            );
            Ok(())
        })
        .on_event(move |_app, _event| {
            #[cfg(any(target_os = "macos", target_os = "android", target_os = "ios"))]
            if let tauri::RunEvent::Opened { urls } = _event {
                queue.urls(_app, urls);
            }
        });
    #[cfg(target_os = "ios")]
    let builder = builder.js_init_script("Object.defineProperty(window, '__PDF_IOS_IMPORT_ONLY__', { value: true, writable: false, configurable: false });");
    builder.build()
}
