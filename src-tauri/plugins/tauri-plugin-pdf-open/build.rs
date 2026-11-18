fn main() {
    tauri_plugin::Builder::new(&[
        "next_pdf_open",
        "read_pdf_open",
        "finish_pdf_open",
        "new_pdf_window",
        "report_window_state",
        "close_pdf_window",
        "cancel_window_close",
    ])
    .build();
}
