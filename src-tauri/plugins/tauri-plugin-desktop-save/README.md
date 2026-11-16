# Desktop PDF saving

The local `desktop-save` Tauri plugin supports Windows, macOS and Linux. Only the
four PDF transaction commands are granted to the local main window. JavaScript
cannot supply a filesystem path or access generic filesystem functions.

`begin_pdf_save`, `append_pdf_save`, `finish_pdf_save` and `abort_pdf_save` use the
same payload/result contract as the Android bridge: one UUID-owned transaction,
150 MiB maximum, ordered Base64 chunks of at most 256 KiB, and a confirmed
`{status:"saved",fileName}` or `{status:"cancelled"}` result. The shared frontend
must not acknowledge the PDF revision until a native saved result arrives.

`rfd` 0.17.2 supplies native save panels, initialized on the UI thread with the
editor window as parent. Waiting and filesystem I/O happen on background threads.
This is the native dialog engine used by Tauri's dialog plugin; using it directly
avoids that plugin's global JavaScript `confirm` replacement. No dialog or generic
filesystem JavaScript permissions are exposed.

Uploaded bytes first enter an app-private temporary file. A complete PDF header
and length are checked before opening the save panel. The selected destination is
written through an exclusively created temporary file in the same directory,
flushed, synced and byte-for-byte verified before atomic rename. The final file is
read back and compared before returning success. A write or commit error leaves
the editor's revision unacknowledged; a commit failure before rename preserves an
existing destination. Only the basename is returned to JavaScript; errors do not
expose private paths or contents. Existing files can be replaced only after the
user selects that target in the native save dialog, which requests overwrite
confirmation.

Staging cleanup is scoped to a UUID instance directory with a portable `fs2`
ownership lock. A root initialization lock covers orphan scanning and instance
creation, so starting another editor cannot delete a live export. Windows handles
are closed before deleting directories. Normal exit/error/cancel releases staging;
a later startup cleans instance directories whose process ownership lock is free.
A hard process kill may leave a hidden destination temporary file; no recovery
journal or power-loss durability guarantee is claimed.

The std-only `src/storage.rs` test suite exercises real filesystem writes,
replacement, cancellation, invalid transfers, collisions and cleanup without
simulating an OS dialog. `cache.rs` additionally checks live-instance isolation and
orphan cleanup with real filesystem locks. Building the Tauri packages checks
native dialog integration; physical OS interaction still needs device testing.
