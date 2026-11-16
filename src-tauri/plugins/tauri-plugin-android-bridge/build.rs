const COMMANDS: &[&str] = &["read_clipboard_image"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
