#![cfg(target_os = "ios")]

mod save_request;

use save_request::{valid_append, valid_begin, valid_id};
use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{mobile::PluginInvokeError, Builder, PluginHandle, TauriPlugin},
    AppHandle, Manager, Runtime,
};

tauri::ios_plugin_binding!(init_plugin_ios_bridge);

struct IosBridge<R: Runtime>(PluginHandle<R>);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedPdf {
    pub path: String,
    pub file_name: String,
    pub byte_length: usize,
}

#[derive(Debug)]
pub struct PdfImportError {
    pub code: String,
    pub message: String,
}

impl PdfImportError {
    fn unavailable() -> Self {
        Self {
            code: "unavailable".into(),
            message: "Die PDF konnte nicht geöffnet werden. Bitte die Datei erneut über ‚Öffnen mit‘ auswählen.".into(),
        }
    }
}

impl From<PluginInvokeError> for PdfImportError {
    fn from(error: PluginInvokeError) -> Self {
        match error {
            PluginInvokeError::InvokeRejected(response) => Self {
                code: response.code.unwrap_or_else(|| "unavailable".into()),
                // Swift returns only fixed messages, never provider error text.
                message: response
                    .message
                    .unwrap_or_else(|| Self::unavailable().message),
            },
            _ => Self::unavailable(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StageIncomingPdf {
    uri: String,
    id: String,
    cache_directory: String,
}

/// The URL comes from the OS, never from a JavaScript command argument.
pub async fn stage_incoming_pdf<R: Runtime>(
    app: &AppHandle<R>,
    uri: String,
    id: String,
) -> Result<StagedPdf, PdfImportError> {
    let cache_directory = app
        .path()
        .app_cache_dir()
        .map_err(|_| PdfImportError::unavailable())?
        .join("pdf-incoming");
    let cache_directory = cache_directory
        .to_str()
        .ok_or_else(PdfImportError::unavailable)?
        .to_owned();
    app.state::<IosBridge<R>>()
        .0
        .run_mobile_plugin_async(
            "stageIncomingPdf",
            StageIncomingPdf {
                uri,
                id,
                cache_directory,
            },
        )
        .await
        .map_err(Into::into)
}

#[derive(Deserialize)]
struct PickedPdf {
    token: Option<String>,
}

pub async fn pick_incoming_pdf<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Option<String>, PdfImportError> {
    let picked: PickedPdf = app
        .state::<IosBridge<R>>()
        .0
        .run_mobile_plugin_async("pickIncomingPdf", ())
        .await?;
    Ok(picked.token)
}

const INVALID: &str = "Die native PDF-Speicheranfrage ist ungültig.";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BeginSave {
    file_name: String,
    byte_length: usize,
}

#[derive(Deserialize, Serialize)]
struct Begun {
    token: String,
}

#[tauri::command]
async fn begin_pdf_save<R: Runtime>(
    app: AppHandle<R>,
    file_name: String,
    byte_length: usize,
) -> Result<Begun, String> {
    if !valid_begin(&file_name, byte_length) {
        return Err(INVALID.into());
    }
    app.state::<IosBridge<R>>()
        .0
        .run_mobile_plugin_async(
            "beginPdfSave",
            BeginSave {
                file_name,
                byte_length,
            },
        )
        .await
        .map_err(save_error)
}

#[derive(Serialize)]
struct AppendSave {
    token: String,
    offset: usize,
    base64: String,
}

#[derive(Deserialize, Serialize)]
struct Appended {
    received: usize,
}

#[tauri::command]
async fn append_pdf_save<R: Runtime>(
    app: AppHandle<R>,
    token: String,
    offset: usize,
    base64: String,
) -> Result<Appended, String> {
    if !valid_append(&token, offset, base64.len()) {
        return Err(INVALID.into());
    }
    app.state::<IosBridge<R>>()
        .0
        .run_mobile_plugin_async(
            "appendPdfSave",
            AppendSave {
                token,
                offset,
                base64,
            },
        )
        .await
        .map_err(save_error)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FinishSave {
    token: String,
    source_id: Option<String>,
    replace_original: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Finished {
    status: String,
    file_name: Option<String>,
}

#[tauri::command]
async fn finish_pdf_save<R: Runtime>(
    app: AppHandle<R>,
    token: String,
    source_id: Option<String>,
    replace_original: Option<bool>,
) -> Result<Finished, String> {
    if !valid_id(&token) || source_id.as_deref().is_some_and(|id| !valid_id(id)) {
        return Err(INVALID.into());
    }
    app.state::<IosBridge<R>>()
        .0
        .run_mobile_plugin_async(
            "finishPdfSave",
            FinishSave {
                token,
                source_id,
                replace_original: replace_original.unwrap_or(false),
            },
        )
        .await
        .map_err(save_error)
}

#[derive(Serialize)]
struct AbortSave {
    token: String,
}

#[tauri::command]
async fn abort_pdf_save<R: Runtime>(app: AppHandle<R>, token: String) -> Result<(), String> {
    if !valid_id(&token) {
        return Err(INVALID.into());
    }
    app.state::<IosBridge<R>>()
        .0
        .run_mobile_plugin_async("abortPdfSave", AbortSave { token })
        .await
        .map_err(save_error)
}

fn save_error(error: PluginInvokeError) -> String {
    match error {
        PluginInvokeError::InvokeRejected(response) => response.message,
        _ => None,
    }
    .unwrap_or_else(|| "iPadOS konnte die PDF-Speicherung nicht bestätigen.".into())
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("ios-bridge")
        .js_init_script("Object.defineProperty(window, '__PDF_IOS_APP__', { value: true, writable: false, configurable: false });")
        .invoke_handler(tauri::generate_handler![begin_pdf_save, append_pdf_save, finish_pdf_save, abort_pdf_save])
        .setup(|app, api| {
            let handle = api.register_ios_plugin(init_plugin_ios_bridge)?;
            app.manage(IosBridge(handle));
            Ok(())
        })
        .build()
}
