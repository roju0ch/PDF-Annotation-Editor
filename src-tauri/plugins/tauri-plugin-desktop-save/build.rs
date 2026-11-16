fn main() {
    tauri_plugin::Builder::new(&[
        "begin_pdf_save",
        "append_pdf_save",
        "finish_pdf_save",
        "abort_pdf_save",
    ])
    .build();
}
