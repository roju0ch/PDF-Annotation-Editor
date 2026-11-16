#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "android")]
    let builder = builder.plugin(tauri_plugin_android_bridge::init());
    builder
        .run(tauri::generate_context!())
        .expect("PDF Viewer konnte nicht gestartet werden");
}
