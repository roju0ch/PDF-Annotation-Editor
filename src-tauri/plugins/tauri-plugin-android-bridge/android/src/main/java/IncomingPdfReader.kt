package io.github.roju0ch.pdfannotationeditor.androidbridge

import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import java.io.Closeable
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

class PdfImportException(val code: String, message: String) : Exception(message)

data class IncomingPdfStaged(val path: String, val fileName: String, val byteLength: Long)

/**
 * Takes a stable private snapshot while Android's temporary read grant is valid.
 * Only Rust's OS-open queue calls this bridge method; JavaScript cannot choose a URI.
 * The queue owns successful snapshots, including their eventual deletion.
 */
class IncomingPdfReader(cacheRoot: File, private val resolver: ContentResolver) : Closeable {
    private data class Source(val fileName: String, val byteLength: Long?, val open: () -> InputStream)
    private val directory = File(cacheRoot, "pdf-incoming")
    private val closed = AtomicBoolean(false)
    private val active = AtomicReference<InputStream?>(null)

    fun stage(value: String): IncomingPdfStaged {
        ensureOpen()
        val source = resolveSource(value)
        if (source.byteLength != null && source.byteLength > MAX_PDF_BYTES) throw tooLarge()
        if ((!directory.exists() && !directory.mkdirs()) || !directory.isDirectory) throw unavailable()
        val file = try { File.createTempFile("pdf-incoming-", ".tmp", directory) }
            catch (_: Exception) { throw unavailable() }
        var completed = false
        try {
            val input = source.open()
            // A later activity destruction must also close a provider stream
            // that opened after close() first inspected the active reference.
            if (!active.compareAndSet(null, input)) {
                input.close()
                throw unavailable()
            }
            var length = 0L
            try {
                input.use { stream ->
                    ensureOpen()
                    FileOutputStream(file).use { output ->
                        val buffer = ByteArray(COPY_BUFFER_BYTES)
                        val header = ByteArray(HEADER_BYTES)
                        var headerLength = 0
                        while (true) {
                            ensureOpen()
                            var count = stream.read(buffer)
                            if (count < 0) break
                            if (count == 0) {
                                // A provider must not turn a zero-length read
                                // into either a premature EOF or an endless spin.
                                val byte = stream.read()
                                if (byte < 0) break
                                buffer[0] = byte.toByte()
                                count = 1
                            }
                            if (length > MAX_PDF_BYTES - count) throw tooLarge()
                            if (headerLength < HEADER_BYTES) {
                                val take = minOf(count, HEADER_BYTES - headerLength)
                                buffer.copyInto(header, headerLength, 0, take)
                                headerLength += take
                                if (headerLength == HEADER_BYTES && !pdfHeader(header, headerLength)) throw invalid()
                            }
                            output.write(buffer, 0, count)
                            length += count
                        }
                        if (length < 5 || !pdfHeader(header, headerLength)) throw invalid()
                        ensureOpen()
                        output.flush()
                        output.fd.sync()
                    }
                }
            } finally {
                active.compareAndSet(input, null)
            }
            ensureOpen()
            if (file.length() != length) throw unavailable()
            completed = true
            return IncomingPdfStaged(file.absolutePath, source.fileName, length)
        } catch (_: SecurityException) {
            throw PdfImportException("denied", "Android erlaubt den Zugriff auf diese PDF nicht. Bitte die Datei erneut über ‚Öffnen mit‘ auswählen.")
        } catch (error: Exception) {
            if (error is PdfImportException) throw error
            throw unavailable()
        } finally {
            if (!completed) file.delete()
        }
    }

    private fun resolveSource(value: String): Source {
        if (value.length > MAX_URI_LENGTH) throw invalid()
        val uri = try { Uri.parse(value) } catch (_: Exception) { throw invalid() }
        return when (uri.scheme) {
            "content" -> {
                if (uri.authority.isNullOrEmpty()) throw invalid()
                val details = metadata(uri)
                Source(details.first, details.second) { resolver.openInputStream(uri) ?: throw unavailable() }
            }
            "file" -> {
                // Legacy local file URIs use only Android's existing filesystem
                // access. No grant is fabricated and no storage permission is
                // requested. Modern cross-app sharing should use content URIs.
                val authority = uri.encodedAuthority.orEmpty()
                if ((authority.isNotEmpty() && !authority.equals("localhost", ignoreCase = true)) || uri.query != null || uri.fragment != null) throw invalid()
                val path = uri.path ?: throw invalid()
                val file = File(path)
                if (!file.isAbsolute || path.indexOf('\u0000') >= 0) throw invalid()
                try {
                    if (!file.isFile) throw unavailable()
                    if (!file.canRead()) throw PdfImportException("denied", "Android erlaubt den Zugriff auf diese PDF nicht. Bitte die Datei erneut über ‚Öffnen mit‘ freigeben.")
                    Source(safeName(file.name), file.length()) { FileInputStream(file) }
                } catch (_: SecurityException) {
                    throw PdfImportException("denied", "Android erlaubt den Zugriff auf diese PDF nicht. Bitte die Datei erneut über ‚Öffnen mit‘ freigeben.")
                }
            }
            else -> throw invalid()
        }
    }

    private fun metadata(uri: Uri): Pair<String, Long?> {
        var name: String? = null
        var length: Long? = null
        try {
            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val nameColumn = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    val sizeColumn = cursor.getColumnIndex(OpenableColumns.SIZE)
                    if (nameColumn >= 0 && !cursor.isNull(nameColumn)) name = cursor.getString(nameColumn)
                    if (sizeColumn >= 0 && !cursor.isNull(sizeColumn)) length = cursor.getLong(sizeColumn).takeIf { it >= 0 }
                }
            }
        } catch (_: Exception) {
            // Metadata may be unavailable even when the granted stream is readable.
            // Never log provider exceptions or infer a filesystem path from a URI.
        }
        return safeName(name) to length
    }

    private fun ensureOpen() {
        if (closed.get()) throw PdfImportException("interrupted", "Das Öffnen der PDF wurde unterbrochen. Bitte die Datei erneut auswählen.")
    }

    override fun close() {
        closed.set(true)
        try { active.getAndSet(null)?.close() } catch (_: Exception) { /* Best effort on activity destruction. */ }
    }

    companion object {
        const val MAX_PDF_BYTES = 100L * 1024 * 1024
        private const val MAX_URI_LENGTH = 64 * 1024
        private const val COPY_BUFFER_BYTES = 64 * 1024
        private const val HEADER_BYTES = 1024

        private fun pdfHeader(header: ByteArray, length: Int): Boolean =
            String(header, 0, length, Charsets.ISO_8859_1).contains("%PDF-")

        private fun safeName(value: String?): String {
            val name = value.orEmpty().replace('\\', '/').substringAfterLast('/')
                .map { if (it.isISOControl()) '_' else it }.joinToString("").trim()
            if (name.isEmpty() || name == "." || name == "..") return "Dokument.pdf"
            // Bound UTF-16 without cutting a surrogate pair.
            val end = if (name.length > 255 && name[254].isHighSurrogate()) 254 else minOf(255, name.length)
            return name.substring(0, end)
        }

        private fun invalid() = PdfImportException("invalid", "Bitte eine gültige PDF-Datei auswählen (maximal 100 MB).")
        private fun tooLarge() = PdfImportException("too-large", "Bitte eine gültige PDF-Datei auswählen (maximal 100 MB).")
        private fun unavailable() = PdfImportException("unavailable", "Die übergebene PDF konnte nicht gelesen werden. Bitte die Datei erneut über ‚Öffnen mit‘ auswählen.")
    }
}
