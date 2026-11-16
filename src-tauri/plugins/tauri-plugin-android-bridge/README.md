# Android bridge

Local Tauri 2 plugin. No external service, background clipboard polling, storage permissions or clipboard contents in logs.

`plugin:android-bridge|read_clipboard_image` is granted only to the local main Android window. It reads a PNG/JPEG from a granted `content://` URI in the current clipboard and returns `{ mimeType, base64 }`. Errors are `{ code, message }` with a German message. Maximum 20 MiB, 20 megapixels and 16,384 pixels per side, matching the PDF image importer. Bounds are checked before image raster decoding. Text and HTTP/file URIs are not dereferenced. Providers may revoke URI access; the file-picker fallback remains necessary.

`AndroidBridgePlugin.load()` applies system bar/cutout insets to the native content host so the WebView viewport and fixed menus stay inside the usable area. The handled insets are consumed for child views; keyboard insets are preserved. Changes such as rotation are handled by Android's inset dispatch.

The Rust and Gradle structure originates from the pinned Tauri CLI 2.12.4 plugin template; only the command above is exposed. Android APK generation builds the Kotlin module alongside the app.
