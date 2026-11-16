#![cfg(target_os = "android")]

use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{mobile::PluginInvokeError, Builder, PluginHandle, TauriPlugin},
    AppHandle, Manager, Runtime,
};

struct AndroidBridge<R: Runtime>(PluginHandle<R>);

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClipboardImage {
    mime_type: String,
    base64: String,
}

#[derive(Serialize)]
struct ClipboardError {
    code: String,
    message: String,
}

impl From<PluginInvokeError> for ClipboardError {
    fn from(error: PluginInvokeError) -> Self {
        match error {
            PluginInvokeError::InvokeRejected(response) => Self {
                code: response.code.unwrap_or_else(|| "unavailable".into()),
                message: response.message.unwrap_or_else(|| {
                    "Die Android-Zwischenablage ist momentan nicht verfügbar.".into()
                }),
            },
            _ => Self {
                code: "unavailable".into(),
                message: "Die Android-Zwischenablage ist momentan nicht verfügbar. Bitte ‚Bild einfügen …‘ verwenden.".into(),
            },
        }
    }
}

#[tauri::command]
async fn read_clipboard_image<R: Runtime>(
    app: AppHandle<R>,
) -> Result<ClipboardImage, ClipboardError> {
    app.state::<AndroidBridge<R>>()
        .0
        .run_mobile_plugin_async("readClipboardImage", ())
        .await
        .map_err(Into::into)
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("android-bridge")
        .invoke_handler(tauri::generate_handler![read_clipboard_image])
        .setup(|app, api| {
            let handle = api.register_android_plugin(
                "io.github.roju0ch.pdfannotationeditor.androidbridge",
                "AndroidBridgePlugin",
            )?;
            app.manage(AndroidBridge(handle));
            Ok(())
        })
        .build()
}
