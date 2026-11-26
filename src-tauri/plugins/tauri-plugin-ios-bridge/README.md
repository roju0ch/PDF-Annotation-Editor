# Native iOS PDF file bridge

`pdf-open` passes OS-opened URLs to Swift from `RunEvent::Opened`. The in-app
document picker retains the native URL until the same queue consumes its
opaque token. Security scopes and coordinated reads convert those grants into
exclusive, bounded app-private copies. JavaScript receives a queue ID and
basename along with bounded reads. Rust takes ownership of the staged copy.

The iOS-only save commands stage the worker export in 256-KiB chunks. Swift
verifies the stage and opens the native document picker. Save As uses the system
copy flow. For original replacement the user reselects and confirms the
original. Swift compares the picked file with the imported fingerprint
inside the coordinated write and prepares the replacement on the same volume.
A size and SHA-256 check of the result precedes acknowledgment in either mode.
Unverified writes preserve the dirty state. The bridge takes no path or URL
from JavaScript.

The Swift core has real-file XCTest coverage without UIKit:

```sh
swift test --package-path src-tauri/plugins/tauri-plugin-ios-bridge/core
```

The iPadOS workflow compiles the UIKit bridge for the ARM64 simulator and
device. The [iPad guide](../../../docs/IPADOS.md) has installation and
hardware verification steps.
