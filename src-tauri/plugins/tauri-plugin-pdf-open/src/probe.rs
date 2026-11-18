//! Read-only diagnostics for the separately compiled CI GUI probe app.
//!
//! This module is never compiled into ordinary installer builds. The CI test
//! explicitly opts in through an absolute report-file environment variable and
//! opens synthetic documents only; there is no JavaScript filesystem command.

use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::Mutex,
};
use tauri::{AppHandle, Manager, Runtime};

static WRITER: Mutex<()> = Mutex::new(());

pub fn enabled() -> bool {
    std::env::var_os("PDF_EDITOR_WINDOW_TEST_REPORT")
        .map(PathBuf::from)
        .is_some_and(|path| path.is_absolute())
}

/// Returns whether actual Cocoa titles have caught up with the current report.
/// The caller can briefly refresh a stale asynchronous title without changing
/// either the native state or the assertions made by the external verifier.
pub fn record<R: Runtime>(
    app: &AppHandle<R>,
    snapshot: impl FnOnce() -> serde_json::Value,
) -> bool {
    let Some(path) = std::env::var_os("PDF_EDITOR_WINDOW_TEST_REPORT") else {
        return true;
    };
    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return true;
    }
    // Snapshot only after obtaining the writer lock. A delayed older event can
    // otherwise overwrite a more recent two-window snapshot with stale state.
    let Ok(_writer) = WRITER.lock() else {
        return true;
    };
    let mut value = snapshot();
    let Some(object) = value.as_object_mut() else {
        return true;
    };
    let windows = app.webview_windows();
    let mut labels: Vec<_> = windows.keys().cloned().collect();
    labels.sort();
    let mut visible = Vec::new();
    let mut titles = serde_json::Map::new();
    for label in &labels {
        if let Some(window) = windows.get(label) {
            if window.is_visible().unwrap_or(false) {
                visible.push(label.clone());
            }
            if let Ok(title) = window.title() {
                titles.insert(label.clone(), title.into());
            }
        }
    }
    let titles_settled = object
        .get("windows")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|reports| {
            reports.iter().all(|report| {
                if report
                    .get("hasDocument")
                    .and_then(serde_json::Value::as_bool)
                    != Some(true)
                {
                    return true;
                }
                let Some(label) = report.get("label").and_then(serde_json::Value::as_str) else {
                    return false;
                };
                let Some(name) = report.get("fileName").and_then(serde_json::Value::as_str) else {
                    return false;
                };
                let expected = format!(
                    "{}{} – PDF Viewer",
                    name,
                    if report.get("unsaved").and_then(serde_json::Value::as_bool) == Some(true) {
                        " •"
                    } else {
                        ""
                    }
                );
                titles.get(label).and_then(serde_json::Value::as_str) == Some(expected.as_str())
            })
        });
    object.insert("schemaVersion".into(), 1.into());
    object.insert("pid".into(), std::process::id().into());
    object.insert("actualWindowLabels".into(), labels.into());
    object.insert("visibleWindowLabels".into(), visible.into());
    object.insert("windowTitles".into(), titles.into());
    let Ok(bytes) = serde_json::to_vec_pretty(&value) else {
        return titles_settled;
    };
    // Keep concurrent accidental probe processes from sharing a temporary
    // pathname. The Python verifier rejects a second process rather than
    // counting its window as an additional window of the original application.
    let temporary = path.with_extension(format!("{}.tmp", std::process::id()));
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| -> std::io::Result<()> {
        let mut output = options.open(&temporary)?;
        output.write_all(&bytes)?;
        output.sync_all()?;
        drop(output);
        fs::rename(&temporary, &path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    titles_settled
}
