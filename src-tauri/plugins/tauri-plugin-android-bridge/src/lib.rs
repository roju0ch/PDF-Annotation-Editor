#![cfg(target_os = "android")]

use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{mobile::PluginInvokeError, Builder, PluginHandle, TauriPlugin},
    AppHandle, Manager, Runtime,
};

struct AndroidBridge<R: Runtime>(PluginHandle<R>);

// Android has one document window. Only a matching native ID may hint its provider.
#[derive(Default)]
struct DocumentLocation(std::sync::Mutex<Option<(String, String)>>);

pub fn remember_open<R: Runtime>(app: &AppHandle<R>, id: String, uri: String) {
    if let Ok(mut location) = app.state::<DocumentLocation>().0.lock() {
        *location = Some((id, uri));
    }
}

const MAX_PDF_BYTES: usize = 150 * 1024 * 1024;
const MAX_PDF_CHUNK_BYTES: usize = 256 * 1024;
const MAX_PDF_CHUNK_BASE64: usize = 4 * MAX_PDF_CHUNK_BYTES.div_ceil(3);

/// A private snapshot from an OS-granted content URI or readable local file URI.
/// The PDF-open queue owns this file and deletes it after delivery or failure.
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
            message: "Die übergebene PDF konnte nicht gelesen werden. Bitte die Datei erneut über ‚Öffnen mit‘ auswählen.".into(),
        }
    }
}

impl From<PluginInvokeError> for PdfImportError {
    fn from(error: PluginInvokeError) -> Self {
        match error {
            PluginInvokeError::InvokeRejected(response) => Self {
                code: response.code.unwrap_or_else(|| "unavailable".into()),
                message: response
                    .message
                    .unwrap_or_else(|| Self::unavailable().message),
            },
            _ => Self::unavailable(),
        }
    }
}

#[derive(Serialize)]
struct StageIncomingPdf {
    uri: String,
}

/// Internal native entry point only. It is intentionally not a tauri::command
/// and is not listed in invoke_handler: JavaScript cannot select an arbitrary
/// URI/path. Tauri's RunEvent::Opened supplies the URI while its temporary
/// Activity read grant is valid; ContentResolver enforces the actual grant.
/// Local file URIs use Android's existing file access without extra permissions.
pub async fn stage_incoming_pdf<R: Runtime>(
    app: &AppHandle<R>,
    uri: String,
) -> Result<StagedPdf, PdfImportError> {
    if uri.len() > 64 * 1024 || (!uri.starts_with("content://") && !uri.starts_with("file://")) {
        return Err(PdfImportError {
            code: "invalid".into(),
            message: "Bitte eine gültige PDF-Datei auswählen (maximal 100 MB).".into(),
        });
    }
    app.state::<AndroidBridge<R>>()
        .0
        .run_mobile_plugin_async("stageIncomingPdf", StageIncomingPdf { uri })
        .await
        .map_err(Into::into)
}

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

#[derive(Serialize)]
struct PdfSaveError {
    code: String,
    message: String,
}

impl PdfSaveError {
    fn invalid(message: &str) -> Self {
        Self {
            code: "invalid".into(),
            message: message.into(),
        }
    }

    fn unavailable() -> Self {
        Self {
            code: "unavailable".into(),
            message: "Die PDF konnte unter Android nicht gespeichert werden. Die Änderungen bleiben ungesichert; bitte erneut versuchen.".into(),
        }
    }
}

impl From<PluginInvokeError> for PdfSaveError {
    fn from(error: PluginInvokeError) -> Self {
        match error {
            PluginInvokeError::InvokeRejected(response) => Self {
                code: response.code.unwrap_or_else(|| "unavailable".into()),
                message: response
                    .message
                    .unwrap_or_else(|| Self::unavailable().message),
            },
            // Never expose provider URIs, file paths or payloads through a
            // native exception's debug text.
            _ => Self::unavailable(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BeginPdfSave {
    file_name: String,
    byte_length: usize,
}

#[derive(Deserialize, Serialize)]
struct PdfSaveSession {
    token: String,
}

#[derive(Serialize)]
struct AppendPdfSave {
    token: String,
    offset: usize,
    base64: String,
}

#[derive(Deserialize, Serialize)]
struct PdfSaveProgress {
    received: usize,
}

#[derive(Serialize)]
struct FinishPdfSave {
    token: String,
    #[serde(rename = "initialUri")]
    initial_uri: Option<String>,
}

#[derive(Serialize)]
struct PdfSaveToken {
    token: String,
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
enum PdfSaveResult {
    Saved {
        #[serde(rename = "fileName")]
        file_name: String,
        #[serde(rename = "uri", skip_serializing, default)]
        uri: Option<String>,
    },
    Cancelled,
}

#[derive(Deserialize)]
struct PdfSaveAborted {}

fn valid_pdf_token(token: &str) -> bool {
    token.len() == 36
        && token.bytes().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}

fn require_pdf_token(token: &str) -> Result<(), PdfSaveError> {
    if valid_pdf_token(token) {
        Ok(())
    } else {
        Err(PdfSaveError::invalid(
            "Der Speichervorgang ist ungültig. Bitte erneut speichern.",
        ))
    }
}

fn pdf_chunk_size(base64: &str) -> Result<usize, PdfSaveError> {
    let invalid = || PdfSaveError::invalid("Die PDF-Übertragungsdaten sind ungültig.");
    if base64.is_empty() || base64.len() > MAX_PDF_CHUNK_BASE64 || base64.len() % 4 != 0 {
        return Err(invalid());
    }
    let padding = base64
        .bytes()
        .rev()
        .take_while(|&byte| byte == b'=')
        .count();
    if padding > 2 {
        return Err(invalid());
    }
    let data_length = base64.len() - padding;
    if !base64
        .bytes()
        .take(data_length)
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'+' || byte == b'/')
    {
        return Err(invalid());
    }
    let decoded = base64.len() / 4 * 3 - padding;
    if decoded == 0 || decoded > MAX_PDF_CHUNK_BYTES {
        return Err(invalid());
    }
    Ok(decoded)
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

#[tauri::command(rename_all = "camelCase")]
async fn begin_pdf_save<R: Runtime>(
    app: AppHandle<R>,
    file_name: String,
    byte_length: usize,
) -> Result<PdfSaveSession, PdfSaveError> {
    if !(5..=MAX_PDF_BYTES).contains(&byte_length) {
        return Err(PdfSaveError::invalid(
            "Bitte eine PDF bis 150 MB speichern.",
        ));
    }
    if file_name.trim().is_empty()
        || file_name.len() > 1024
        || file_name
            .chars()
            .any(|character| character.is_control() || character == '/' || character == '\\')
    {
        return Err(PdfSaveError::invalid("Der PDF-Dateiname ist ungültig."));
    }
    let session: PdfSaveSession = app
        .state::<AndroidBridge<R>>()
        .0
        .run_mobile_plugin_async(
            "beginPdfSave",
            BeginPdfSave {
                file_name,
                byte_length,
            },
        )
        .await?;
    require_pdf_token(&session.token)?;
    Ok(session)
}

#[tauri::command]
async fn append_pdf_save<R: Runtime>(
    app: AppHandle<R>,
    token: String,
    offset: usize,
    base64: String,
) -> Result<PdfSaveProgress, PdfSaveError> {
    require_pdf_token(&token)?;
    let received = offset
        .checked_add(pdf_chunk_size(&base64)?)
        .filter(|value| *value <= MAX_PDF_BYTES)
        .ok_or_else(|| PdfSaveError::invalid("Die PDF-Übertragungsgröße ist ungültig."))?;
    let progress: PdfSaveProgress = app
        .state::<AndroidBridge<R>>()
        .0
        .run_mobile_plugin_async(
            "appendPdfSave",
            AppendPdfSave {
                token,
                offset,
                base64,
            },
        )
        .await?;
    if progress.received != received {
        return Err(PdfSaveError::invalid(
            "Die PDF wurde nicht vollständig übertragen. Bitte erneut speichern.",
        ));
    }
    Ok(progress)
}

#[tauri::command]
async fn finish_pdf_save<R: Runtime>(
    app: AppHandle<R>,
    token: String,
    source_id: Option<String>,
) -> Result<PdfSaveResult, PdfSaveError> {
    require_pdf_token(&token)?;
    let initial_uri = app
        .state::<DocumentLocation>()
        .0
        .lock()
        .ok()
        .and_then(|location| {
            location
                .as_ref()
                .filter(|(id, _)| Some(id.as_str()) == source_id.as_deref())
                .map(|(_, uri)| uri.clone())
        });
    let result: PdfSaveResult = app
        .state::<AndroidBridge<R>>()
        .0
        // The native promise stays pending while the user chooses a destination
        // and until ContentResolver write/close/readback verification completes.
        .run_mobile_plugin_async(
            "finishPdfSave",
            FinishPdfSave {
                token: token.clone(),
                initial_uri,
            },
        )
        .await?;
    if let PdfSaveResult::Saved {
        uri: Some(ref uri), ..
    } = result
    {
        remember_open(&app, token, uri.clone());
    }
    Ok(result)
}

#[tauri::command]
async fn abort_pdf_save<R: Runtime>(app: AppHandle<R>, token: String) -> Result<(), PdfSaveError> {
    require_pdf_token(&token)?;
    let _: PdfSaveAborted = app
        .state::<AndroidBridge<R>>()
        .0
        .run_mobile_plugin_async("abortPdfSave", PdfSaveToken { token })
        .await?;
    Ok(())
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("android-bridge")
        .invoke_handler(tauri::generate_handler![
            read_clipboard_image,
            begin_pdf_save,
            append_pdf_save,
            finish_pdf_save,
            abort_pdf_save
        ])
        .setup(|app, api| {
            let handle = api.register_android_plugin(
                "io.github.roju0ch.pdfannotationeditor.androidbridge",
                "AndroidBridgePlugin",
            )?;
            app.manage(AndroidBridge(handle));
            app.manage(DocumentLocation::default());
            Ok(())
        })
        .build()
}
