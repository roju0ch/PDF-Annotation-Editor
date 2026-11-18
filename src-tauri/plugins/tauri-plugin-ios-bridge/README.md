# iOS PDF intake bridge

This private native adapter materializes only a PDF URL supplied by iOS through
Tauri's `RunEvent::Opened`. It exposes no JavaScript command or generic filesystem
API. The shared Rust PDF-open queue calls `stage_incoming_pdf` and owns the staged
file after the call succeeds.

The Swift adapter acquires an external document's security scope, coordinates its
read with `NSFileCoordinator`, and copies at most 100 MiB to a private, exclusive
0600 cache file. App-container copies such as `Documents/Inbox` require no external
scope. A missing external grant, nonlocal URL, nonregular file, invalid PDF header,
or excessive length fails with a fixed error and removes its partial copy. Source
files remain unchanged. Scope ownership lasts until all streams close.

Rust computes `app_cache_dir()/pdf-incoming` and passes that internal location to
Swift. This also respects Tauri's bundle identifier in the iOS cache path.

The Foundation-only core has real-file XCTest coverage without UIKit or a device:

```sh
swift test --package-path src-tauri/plugins/tauri-plugin-ios-bridge/core
```

The iOS plugin's SDK integration is compiled by the simulator build. Simulator
compilation and these tests do not establish real-device Files/provider grants or
an installable, signed iPhone IPA. Those require separate device testing and Apple
signing credentials outside the repository.
