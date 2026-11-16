# Android bridge

Local Tauri 2 plugin. No external service, background clipboard polling, broad storage permissions or document/clipboard contents in logs.

`plugin:android-bridge|read_clipboard_image` is granted only to the local main Android window. It reads a PNG/JPEG from a granted `content://` URI in the current clipboard and returns `{ mimeType, base64 }`. Errors are `{ code, message }` with a German message. Maximum 20 MiB, 20 megapixels and 16,384 pixels per side, matching the PDF image importer. Bounds are checked before image raster decoding. Text and HTTP/file URIs are not dereferenced. Providers may revoke URI access; the file-picker fallback remains necessary.

`AndroidBridgePlugin.load()` applies system bar/cutout insets to the native content host so the WebView viewport and fixed menus stay inside the usable area. The handled insets are consumed for child views; keyboard insets are preserved. Changes such as rotation are handled by Android's inset dispatch.

The PDF save commands are granted separately, also only to the local main Android window:

- `begin_pdf_save({ fileName, byteLength })` stages one PDF in private app cache and returns `{ token }`.
- `append_pdf_save({ token, offset, base64 })` accepts consecutive chunks of at most 256 KiB, returning `{ received }`. PDFs are transferred in bounded chunks instead of a single unbounded base64 payload. Transfers are bounded to the editor's 150 MiB export limit.
- `finish_pdf_save({ token })` opens Android's `ACTION_CREATE_DOCUMENT` destination picker. The native promise resolves with `{ status: "saved", fileName }` only after writing, closing and readback verification; cancellation returns `{ status: "cancelled" }`. The caller must acknowledge the PDF editor's saved revision only for `saved`.
- `abort_pdf_save({ token })` releases the matching private staging transaction. It cannot abort a different transaction.

Only the selected document's temporary URI grant is used; there is no general filesystem permission or persistent URI access. The destination URI is not returned to JavaScript. Native errors use `{ code, message }` without provider URIs, private paths or PDF contents. The native layer owns staging cleanup and does not imply a recovery journal. The Android-specific capability is `android-pdf-save`; other platforms do not receive these commands.

The Rust and Gradle structure originates from the pinned Tauri CLI 2.12.4 plugin template. Android APK generation builds the Kotlin module alongside the app.
