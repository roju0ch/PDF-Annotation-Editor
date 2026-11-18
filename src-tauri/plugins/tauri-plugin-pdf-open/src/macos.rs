//! macOS document windows. Only the originating WebView can consume its queue.
use super::{
    intake::UrlPolicy,
    routing::{Route, Routes, WindowReport},
    *,
};
use std::collections::{BTreeMap, VecDeque};
use tauri::{
    menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu},
    WebviewUrl, WebviewWindowBuilder,
};

const NEW_WINDOW: &str = "pdf-new-window";
const WINDOW_ERROR: &str = "pdf-window-error";

pub(super) struct Windows {
    routes: Routes,
    sessions: BTreeMap<String, Session>,
    quit_pending: VecDeque<String>,
    quit_active: Option<String>,
}
impl Windows {
    pub fn new(main: Session) -> Self {
        let mut sessions = BTreeMap::new();
        sessions.insert("main".into(), main);
        Self {
            routes: Routes::default(),
            sessions,
            quit_pending: VecDeque::new(),
            quit_active: None,
        }
    }
    pub fn session(&self, label: &str) -> Result<Session, OpenError> {
        if !self.routes.registered(label) {
            return Err(OpenError::invalid());
        }
        self.sessions
            .get(label)
            .cloned()
            .ok_or_else(OpenError::invalid)
    }
    fn cancel_quit(&mut self) {
        self.routes.cancel_quit();
        self.quit_pending.clear();
        self.quit_active = None;
    }
}

fn error<R: Runtime>(app: &AppHandle<R>, error: OpenError) {
    // No paths, URIs, or contents cross this error-only notification.
    let labels = state(app)
        .windows
        .lock()
        .ok()
        .map(|windows| windows.routes.labels())
        .unwrap_or_default();
    for label in labels {
        let _ = app.emit_to(&label, WINDOW_ERROR, &error);
    }
}

fn focus<R: Runtime>(app: &AppHandle<R>, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn build_window<R: Runtime>(app: &AppHandle<R>, label: &str) -> Result<(), OpenError> {
    WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title("PDF Viewer")
        .inner_size(1280.0, 850.0)
        .min_inner_size(400.0, 400.0)
        .build()
        .map_err(|_| OpenError::unavailable())?;
    record(app);
    Ok(())
}

fn rollback<R: Runtime>(app: &AppHandle<R>, label: &str) {
    let broker = state(app);
    if let Ok(mut windows) = broker.windows.lock() {
        windows.routes.remove(label);
        if let Some(session) = windows.sessions.remove(label) {
            session.close();
        }
    }
    record(app);
}

fn create_empty<R: Runtime>(app: &AppHandle<R>) -> Result<(), OpenError> {
    let broker = state(app);
    let label = {
        let mut windows = broker
            .windows
            .lock()
            .map_err(|_| OpenError::unavailable())?;
        windows.cancel_quit();
        let label = windows.routes.register_empty()?;
        windows.sessions.insert(label.clone(), Session::new(&label));
        label
    };
    if let Err(failure) = build_window(app, &label) {
        rollback(app, &label);
        return Err(failure);
    }
    focus(app, &label);
    Ok(())
}

fn dispatch<R: Runtime>(app: &AppHandle<R>, source: Source) -> Result<(), OpenError> {
    let broker = state(app);
    let route = {
        let mut windows = broker
            .windows
            .lock()
            .map_err(|_| OpenError::unavailable())?;
        // Explicit new work means the user is continuing, rather than quitting.
        windows.cancel_quit();
        let route = windows.routes.route(&source, Instant::now())?;
        if let Route::Create(ref label) = route {
            windows.sessions.insert(label.clone(), Session::new(label));
        }
        route
    };
    let (label, create, deliver) = match route {
        Route::Existing(label) => (label, false, false),
        Route::Reuse(label) => (label, false, true),
        Route::Create(label) => (label, true, true),
    };
    if create {
        if let Err(failure) = build_window(app, &label) {
            rollback(app, &label);
            return Err(failure);
        }
    }
    if deliver {
        broker.session(&label)?.push(app, source);
    }
    focus(app, &label);
    record(app);
    Ok(())
}

async fn on_ui<R: Runtime, T: Send + 'static>(
    app: AppHandle<R>,
    action: impl FnOnce(AppHandle<R>) -> Result<T, OpenError> + Send + 'static,
) -> Result<T, OpenError> {
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    let ui = app.clone();
    app.run_on_main_thread(move || {
        let _ = sender.send(action(ui));
    })
    .map_err(|_| OpenError::unavailable())?;
    io(move || {
        receiver
            .recv()
            .unwrap_or_else(|_| Err(OpenError::unavailable()))
    })
    .await
}

#[tauri::command]
pub async fn new_pdf_window<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<(), OpenError> {
    state(&app).session(window.label())?;
    on_ui(app, |app| create_empty(&app)).await
}

fn name(value: &str) -> String {
    if value.trim().is_empty()
        || value.encode_utf16().count() > 255
        || value
            .chars()
            .any(|c| c.is_control() || c == '/' || c == '\\')
    {
        "Dokument.pdf".into()
    } else {
        value.into()
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn report_window_state<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    has_document: bool,
    unsaved: bool,
    busy: bool,
    file_name: String,
    page_count: Option<usize>,
) -> Result<(), OpenError> {
    let label = window.label().to_owned();
    let report = WindowReport {
        has_document,
        unsaved,
        busy,
        file_name: if has_document {
            name(&file_name)
        } else {
            String::new()
        },
        page_count: if has_document {
            page_count.unwrap_or(0).min(2000)
        } else {
            0
        },
    };
    on_ui(app, move |app| {
        let broker = state(&app);
        let title = if report.has_document {
            format!(
                "{}{} – PDF Viewer",
                report.file_name,
                if report.unsaved { " •" } else { "" }
            )
        } else {
            "PDF Viewer".into()
        };
        broker
            .windows
            .lock()
            .map_err(|_| OpenError::unavailable())?
            .routes
            .report(&label, report)?;
        // Update the actual Cocoa title before CI records its native snapshot.
        app.get_webview_window(&label)
            .ok_or_else(OpenError::invalid)?
            .set_title(&title)
            .map_err(|_| OpenError::unavailable())?;
        record(&app);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn close_pdf_window<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<(), OpenError> {
    let label = window.label().to_owned();
    on_ui(app, move |app| {
        let broker = state(&app);
        broker
            .windows
            .lock()
            .map_err(|_| OpenError::unavailable())?
            .routes
            .begin_close(&label)?;
        let result = app
            .get_webview_window(&label)
            .ok_or_else(OpenError::invalid)?
            .destroy()
            .map_err(|_| OpenError::unavailable());
        if result.is_err() {
            if let Ok(mut windows) = broker.windows.lock() {
                windows.routes.cancel_close(&label);
                windows.cancel_quit();
            }
        }
        result
    })
    .await
}

#[tauri::command]
pub async fn cancel_window_close<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<(), OpenError> {
    let broker = state(&app);
    let mut windows = broker
        .windows
        .lock()
        .map_err(|_| OpenError::unavailable())?;
    windows.session(window.label())?;
    windows.routes.cancel_close(window.label());
    windows.cancel_quit();
    Ok(())
}

pub(super) fn release<R: Runtime>(app: &AppHandle<R>, label: &str) {
    if let Ok(mut windows) = state(app).windows.lock() {
        windows.routes.release(label);
    }
    record(app);
}

fn next_quit<R: Runtime>(app: &AppHandle<R>) {
    let broker = state(app);
    let label = {
        let Ok(mut windows) = broker.windows.lock() else {
            return;
        };
        if !windows.routes.is_quitting() || windows.quit_active.is_some() {
            return;
        }
        let mut next = None;
        while let Some(label) = windows.quit_pending.pop_front() {
            if windows.routes.registered(&label) {
                next = Some(label);
                break;
            }
        }
        windows.quit_active = next.clone();
        next
    };
    if let Some(label) = label {
        if let Some(window) = app.get_webview_window(&label) {
            if window.close().is_err() {
                if let Ok(mut windows) = broker.windows.lock() {
                    windows.cancel_quit();
                }
                error(app, OpenError::unavailable());
            }
        }
    }
}

fn request_quit<R: Runtime>(app: &AppHandle<R>, broker: &PdfOpen) {
    {
        let Ok(mut windows) = broker.windows.lock() else {
            return;
        };
        let labels = windows.routes.request_quit();
        if !labels.is_empty() {
            windows.quit_pending = labels.into();
        }
    }
    next_quit(app);
}

fn destroyed<R: Runtime>(app: &AppHandle<R>, broker: &PdfOpen, label: &str) {
    let (session, exit) = {
        let Ok(mut windows) = broker.windows.lock() else {
            return;
        };
        let session = windows.sessions.remove(label);
        if windows.quit_active.as_deref() == Some(label) {
            windows.quit_active = None;
        }
        let exit = windows.routes.remove(label);
        (session, exit)
    };
    if let Some(session) = session {
        session.close();
    }
    record(app);
    if exit {
        app.exit(0);
    } else {
        next_quit(app);
    }
}

pub(super) fn setup<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    // Preserve the SDK's standard app/edit/window menus and their native text
    // editing behavior. Add the one missing document-window action to File.
    let menu = Menu::default(app)?;
    let item = MenuItem::with_id(app, NEW_WINDOW, "Neues Fenster", true, Some("CmdOrCtrl+N"))?;
    let mut inserted = false;
    for candidate in menu.items()? {
        if let MenuItemKind::Submenu(submenu) = candidate {
            if submenu.text()? == "File" {
                submenu.set_text("Datei")?;
                submenu.insert(&item, 0)?;
                submenu.insert(&PredefinedMenuItem::separator(app)?, 1)?;
                inserted = true;
            } else if submenu.id().as_ref() == tauri::menu::WINDOW_SUBMENU_ID {
                submenu.set_text("Fenster")?;
            }
        }
    }
    if !inserted {
        menu.insert(
            &Submenu::with_items(
                app,
                "Datei",
                true,
                &[&item, &PredefinedMenuItem::close_window(app, None)?],
            )?,
            1,
        )?;
    }
    app.set_menu(menu)?;
    record(app);
    Ok(())
}

pub(super) fn on_event<R: Runtime>(app: &AppHandle<R>, broker: &PdfOpen, event: &tauri::RunEvent) {
    match event {
        tauri::RunEvent::Opened { urls } => {
            for url in urls {
                if let Err(failure) = dispatch(app, Source::from_url(url, UrlPolicy::Desktop)) {
                    error(app, failure);
                }
            }
        }
        tauri::RunEvent::MenuEvent(event) if event.id().as_ref() == NEW_WINDOW => {
            if let Err(failure) = create_empty(app) {
                error(app, failure);
            }
        }
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::Destroyed,
            ..
        } => destroyed(app, broker, label),
        tauri::RunEvent::ExitRequested { api, .. } => {
            let has_windows = broker
                .windows
                .lock()
                .map(|windows| !windows.routes.is_empty())
                .unwrap_or(true);
            if has_windows {
                api.prevent_exit();
                request_quit(app, broker);
            }
        }
        tauri::RunEvent::Reopen { .. } => {
            let empty = broker
                .windows
                .lock()
                .map(|windows| windows.routes.is_empty())
                .unwrap_or(false);
            if empty {
                if let Err(failure) = create_empty(app) {
                    error(app, failure);
                }
            }
        }
        tauri::RunEvent::Ready => record(app),
        _ => {}
    }
}

fn record<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(feature = "native-window-tests")]
    {
        // Finish/ACK can arrive on a runtime worker. Do not hold the probe's
        // writer lock there while synchronously querying Cocoa: a UI-thread
        // report could otherwise wait for that lock while the worker waits
        // for Cocoa. Serialize the complete snapshot on the UI thread.
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            super::probe::record(&handle, || {
                let broker = state(&handle);
                let Ok(windows) = broker.windows.lock() else {
                    return serde_json::json!({ "windows": [] });
                };
                let reports: Vec<_> = windows
                    .routes
                    .labels()
                    .iter()
                    .filter_map(|label| {
                        windows.routes.window_report(label).map(|report| {
                            serde_json::json!({
                                "label": label, "fileName": report.file_name,
                                "hasDocument": report.has_document, "unsaved": report.unsaved,
                                "busy": report.busy, "pageCount": report.page_count,
                            })
                        })
                    })
                    .collect();
                serde_json::json!({ "windows": reports })
            });
        });
    }
    #[cfg(not(feature = "native-window-tests"))]
    let _ = app;
}
