fn main() {
    tauri_plugin::Builder::new(&["next_pdf_open", "read_pdf_open", "finish_pdf_open"]).build();
}
