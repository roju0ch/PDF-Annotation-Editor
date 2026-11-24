#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pdf_open = tauri_plugin_pdf_open::PdfOpen::default();
    let builder = tauri::Builder::default();
    // The official plugin must run first: a secondary process forwards its
    // arguments into this already-created queue and exits before other setup.
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    let builder = {
        let forwarding = pdf_open.clone();
        builder.plugin(tauri_plugin_single_instance::init(move |app, args, cwd| {
            forwarding.arguments(app, args, std::path::Path::new(&cwd));
        }))
    };
    #[cfg(target_os = "android")]
    let builder = builder.plugin(tauri_plugin_android_bridge::init());
    #[cfg(target_os = "ios")]
    let builder = builder.plugin(tauri_plugin_ios_bridge::init());
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    let builder = builder.plugin(tauri_plugin_desktop_save::init());
    builder
        .plugin(tauri_plugin_pdf_open::init(pdf_open))
        .run(tauri::generate_context!())
        .expect("PDF Viewer konnte nicht gestartet werden");
}
