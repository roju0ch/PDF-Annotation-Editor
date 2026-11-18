#![cfg(target_os = "ios")]

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
    cache_directory: String,
}

/// The URL comes from the OS, never from a JavaScript command argument.
pub async fn stage_incoming_pdf<R: Runtime>(
    app: &AppHandle<R>,
    uri: String,
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
                cache_directory,
            },
        )
        .await
        .map_err(Into::into)
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("ios-bridge")
        .setup(|app, api| {
            let handle = api.register_ios_plugin(init_plugin_ios_bridge)?;
            app.manage(IosBridge(handle));
            Ok(())
        })
        .build()
}
