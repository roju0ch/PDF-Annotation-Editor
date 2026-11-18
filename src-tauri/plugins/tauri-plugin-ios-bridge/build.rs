fn main() {
    // Staging is called only by Rust in response to RunEvent::Opened. It is not
    // an arbitrary URL/file-reading command exposed to JavaScript.
    tauri_plugin::Builder::new(&[]).ios_path("ios").build();
}
