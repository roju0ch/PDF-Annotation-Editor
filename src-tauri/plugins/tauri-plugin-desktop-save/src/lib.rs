#![cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]

mod cache;
mod storage;
mod windows;

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{mpsc, Arc, Mutex},
};
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Manager, Runtime, WebviewWindow,
};

#[derive(Serialize)]
struct CommandError {
    code: &'static str,
    message: &'static str,
}
impl From<storage::SaveError> for CommandError {
    fn from(error: storage::SaveError) -> Self {
        Self {
            code: error.code,
            message: error.message,
        }
    }
}
fn unavailable() -> CommandError {
    storage::unavailable().into()
}
fn invalid() -> CommandError {
    storage::invalid().into()
}
type Result<T> = std::result::Result<T, CommandError>;

struct DesktopSave(Arc<Mutex<windows::Windows>>);

#[derive(Serialize)]
struct Session {
    token: String,
}
#[derive(Serialize)]
struct Progress {
    received: usize,
}
#[derive(Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
enum SaveResult {
    Saved {
        #[serde(rename = "fileName")]
        file_name: String,
    },
    Cancelled,
}

async fn io<T: Send + 'static>(task: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|_| unavailable())?
}

fn owner<R: Runtime>(app: &AppHandle<R>, window: &WebviewWindow<R>) -> Result<windows::WindowSave> {
    let registry = app.state::<DesktopSave>().0.clone();
    let owner = registry
        .lock()
        .map_err(|_| unavailable())?
        .get(window.label());
    owner.map_err(Into::into)
}

/// Called only after the PDF-open queue finishes an accepted OS-selected document.
pub fn remember_open<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    id: String,
    path: PathBuf,
) {
    if let Ok(owner) = owner(app, window) {
        owner.remember_location(id, &path);
    }
}

#[tauri::command(rename_all = "camelCase")]
async fn begin_pdf_save<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    file_name: String,
    byte_length: usize,
) -> Result<Session> {
    let owner = owner(&app, &window)?;
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|_| unavailable())?
        .join("desktop-pdf-exports");
    io(move || {
        let token = owner.begin(&directory, file_name, byte_length)?;
        Ok(Session { token })
    })
    .await
}

#[tauri::command]
async fn append_pdf_save<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    token: String,
    offset: usize,
    base64: String,
) -> Result<Progress> {
    if !storage::valid_token(&token)
        || base64.is_empty()
        || base64.len() > 4 * storage::MAX_CHUNK_BYTES.div_ceil(3)
    {
        return Err(invalid());
    }
    let bytes = STANDARD.decode(base64.as_bytes()).map_err(|_| invalid())?;
    if bytes.len() > storage::MAX_CHUNK_BYTES || STANDARD.encode(&bytes) != base64 {
        return Err(invalid());
    }
    let owner = owner(&app, &window)?;
    io(move || {
        owner
            .append(&token, offset, &bytes)
            .map(|received| Progress { received })
            .map_err(Into::into)
    })
    .await
}

/// Construct native dialog futures on the UI thread, as rfd's GTK/Cocoa APIs require.
/// Waiting and all filesystem work happen away from the WebView/main event loop.
async fn choose_target<R: Runtime>(
    app: &AppHandle<R>,
    window: WebviewWindow<R>,
    owner: windows::WindowSave,
    name: String,
    directory: Option<PathBuf>,
) -> Result<Option<PathBuf>> {
    let (tx, rx) = mpsc::sync_channel(1);
    let handle = app.clone();
    app.run_on_main_thread(move || {
        // Recheck on the actual UI thread: the owner may have been destroyed
        // between preparing the file and scheduling creation of its sheet.
        if !owner.is_open() || handle.get_webview_window(window.label()).is_none() {
            let _ = tx.send(None);
            return;
        }
        let picker = rfd::AsyncFileDialog::new()
            .set_parent(&window)
            .set_title("PDF speichern unter")
            .add_filter("PDF-Dokument", &["pdf"])
            .set_file_name(name);
        let picker = match directory {
            Some(dir) => picker.set_directory(dir),
            None => picker,
        }
        .save_file();
        std::thread::spawn(move || {
            let selected =
                tauri::async_runtime::block_on(picker).map(|file| file.path().to_owned());
            let _ = tx.send(selected);
        });
    })
    .map_err(|_| unavailable())?;
    io(move || rx.recv().map_err(|_| unavailable())).await
}

#[tauri::command]
async fn finish_pdf_save<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    token: String,
    source_id: Option<String>,
) -> Result<SaveResult> {
    if !storage::valid_token(&token) {
        return Err(invalid());
    }
    let owner = owner(&app, &window)?;
    let preparing = owner.clone();
    let preparing_token = token.clone();
    let (name, directory) = io(move || {
        Ok((
            preparing.prepare(&preparing_token)?,
            preparing.initial_directory(source_id.as_deref()),
        ))
    })
    .await?;
    let target = choose_target(&app, window, owner.clone(), name, directory).await;
    // Even a failed dialog clears this transaction without acknowledging a file.
    let dialog_error = target.is_err();
    let path = target.ok().flatten();
    let completion = io(move || owner.finish(&token, path.as_deref()).map_err(Into::into)).await?;
    if dialog_error {
        return Err(unavailable());
    }
    Ok(match completion {
        Some(file_name) => SaveResult::Saved { file_name },
        None => SaveResult::Cancelled,
    })
}

#[tauri::command]
async fn abort_pdf_save<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    token: String,
) -> Result<()> {
    if !storage::valid_token(&token) {
        return Err(invalid());
    }
    let owner = owner(&app, &window)?;
    io(move || owner.abort(&token).map_err(Into::into)).await
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    let registry = Arc::new(Mutex::new(windows::Windows::default()));
    let setup_registry = registry.clone();
    let window_registry = registry.clone();
    Builder::new("desktop-save")
        .invoke_handler(tauri::generate_handler![
            begin_pdf_save,
            append_pdf_save,
            finish_pdf_save,
            abort_pdf_save
        ])
        .setup(move |app, _| {
            app.manage(DesktopSave(setup_registry.clone()));
            let handle = app.clone();
            // Cleanup is best effort on startup; an unavailable cache must not
            // prevent viewing PDFs. A save attempt reports its own I/O error.
            tauri::async_runtime::spawn_blocking(move || {
                if let Ok(path) = handle.path().app_cache_dir() {
                    if let Ok(instance) =
                        cache::CacheInstance::new(&path.join("desktop-pdf-exports"))
                    {
                        drop(instance);
                    }
                }
            });
            Ok(())
        })
        .on_window_ready(move |window| {
            if let Ok(mut registry) = window_registry.lock() {
                registry.register(window.label());
            }
        })
        .on_event(move |_, event| {
            if let tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::Destroyed,
                ..
            } = event
            {
                let owner = registry
                    .lock()
                    .ok()
                    .and_then(|mut state| state.retire(label));
                if let Some(owner) = owner {
                    tauri::async_runtime::spawn_blocking(move || owner.cleanup());
                }
            }
        })
        .build()
}
