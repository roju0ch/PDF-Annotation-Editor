const COMMANDS: &[&str] = &[
    "read_clipboard_image",
    "begin_pdf_save",
    "append_pdf_save",
    "finish_pdf_save",
    "abort_pdf_save",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
