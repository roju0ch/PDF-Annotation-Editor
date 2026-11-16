package io.github.roju0ch.pdfannotationeditor.androidbridge

import android.app.Activity
import android.content.ContentResolver
import android.content.Intent
import android.provider.OpenableColumns
import android.util.Base64
import java.io.Closeable
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

class PdfSaveException(val code: String, message: String) : Exception(message)

data class PdfSaveResult(val status: String, val fileName: String? = null)

/** One bounded private staging file; only a user-selected SAF URI receives PDF bytes. */
class PdfSaveSession(cacheRoot: File, private val resolver: ContentResolver) : Closeable {
    private enum class Phase { UPLOAD, PREPARING, PICKER, WRITING }

    private class Upload(
        val token: String,
        val fileName: String,
        val byteLength: Int,
        val file: File,
        var output: FileOutputStream?,
    ) {
        var received = 0
        var phase = Phase.UPLOAD
        var digest: ByteArray? = null
        val cancelled = AtomicBoolean(false)
    }

    private val directory = File(cacheRoot, "pdf-exports")
    private var active: Upload? = null
    private var closed = false

    init {
        // Process termination may skip onDestroy. Remove only our own orphaned files.
        removeOrphans()
    }

    @Synchronized
    fun begin(fileName: String, byteLength: Int): String {
        if (closed) throw unavailable()
        if (active != null) throw PdfSaveException("busy", "Eine PDF wird bereits gespeichert. Bitte den laufenden Vorgang abschließen.")
        if (byteLength < 5 || byteLength > MAX_PDF_BYTES) {
            throw PdfSaveException("too-large", "Bitte eine gültige PDF bis 150 MB speichern.")
        }
        if ((!directory.exists() && !directory.mkdirs()) || !directory.isDirectory) throw unavailable()
        if (!removeOrphans()) throw unavailable()
        val file = try {
            File.createTempFile("pdf-export-", ".tmp", directory)
        } catch (_: IOException) {
            throw unavailable()
        }
        val output = try { FileOutputStream(file) } catch (_: IOException) {
            file.delete()
            throw unavailable()
        }
        val upload = Upload(UUID.randomUUID().toString(), suggestedName(fileName), byteLength, file, output)
        active = upload
        return upload.token
    }

    @Synchronized
    fun append(token: String, offset: Int, base64: String): Int {
        val upload = requireUpload(token, Phase.UPLOAD)
        try {
            if (offset != upload.received || base64.isEmpty() || base64.length > MAX_BASE64_LENGTH || base64.length % 4 != 0) {
                throw invalid()
            }
            val padding = base64.takeLastWhile { it == '=' }.length
            if (padding > 2 || base64.dropLast(padding).any { it !in 'A'..'Z' && it !in 'a'..'z' && it !in '0'..'9' && it != '+' && it != '/' }) {
                throw invalid()
            }
            val bytes = try { Base64.decode(base64, Base64.NO_WRAP) } catch (_: IllegalArgumentException) {
                throw invalid()
            }
            if (bytes.isEmpty() || bytes.size > MAX_CHUNK_BYTES || Base64.encodeToString(bytes, Base64.NO_WRAP) != base64 || bytes.size > upload.byteLength - upload.received) {
                throw invalid()
            }
            upload.output!!.write(bytes)
            upload.received += bytes.size
            return upload.received
        } catch (error: Exception) {
            discard(upload)
            if (error is PdfSaveException) throw error
            throw unavailable()
        }
    }

    fun prepare(token: String): Intent {
        val upload = synchronized(this) {
            val upload = requireUpload(token, Phase.UPLOAD)
            upload.phase = Phase.PREPARING
            upload
        }
        try {
            if (upload.received != upload.byteLength) throw invalid()
            upload.output!!.apply { flush(); fd.sync(); close() }
            upload.output = null
            if (upload.file.length() != upload.byteLength.toLong()) throw invalid()
            val header = ByteArray(5)
            val headerLength = upload.file.inputStream().use { it.read(header) }
            if (headerLength != header.size || !header.contentEquals(PDF_HEADER)) throw invalid()
            upload.digest = upload.file.inputStream().use { digest(it, upload.byteLength, upload) }
            synchronized(this) {
                ensureActive(upload)
                upload.phase = Phase.PICKER
            }
            return Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "application/pdf"
                putExtra(Intent.EXTRA_TITLE, upload.fileName)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            }
        } catch (error: Exception) {
            synchronized(this) { discard(upload) }
            if (error is PdfSaveException) throw error
            throw unavailable()
        }
    }

    /** Blocking provider I/O belongs on the plugin's single background executor. */
    fun finish(token: String, resultCode: Int, data: Intent?): PdfSaveResult {
        val upload = synchronized(this) {
            val upload = requireUpload(token, Phase.PICKER)
            if (resultCode == Activity.RESULT_CANCELED) {
                discard(upload)
                return PdfSaveResult("cancelled")
            }
            upload.phase = Phase.WRITING
            upload
        }
        try {
            if (resultCode != Activity.RESULT_OK) throw invalid()
            val uri = data?.data
            if (uri == null || uri.scheme != "content" || uri.authority.isNullOrBlank()) throw invalid()
            ensureActive(upload)
            resolver.openOutputStream(uri, "wt")?.use { output ->
                upload.file.inputStream().use { source ->
                    val buffer = ByteArray(IO_BUFFER_BYTES)
                    var written = 0
                    while (true) {
                        ensureActive(upload)
                        val count = source.read(buffer)
                        if (count < 0) break
                        if (count > upload.byteLength - written) throw invalid()
                        output.write(buffer, 0, count)
                        written += count
                    }
                    if (written != upload.byteLength) throw invalid()
                }
                output.flush()
            } ?: throw unavailable()
            // Closing a provider stream is not enough: verify exact length and SHA-256.
            val actual = resolver.openInputStream(uri)?.use { digest(it, upload.byteLength, upload) }
                ?: throw unavailable()
            if (!MessageDigest.isEqual(upload.digest ?: throw invalid(), actual)) {
                throw PdfSaveException("verification", "Die gespeicherte PDF konnte nicht vollständig bestätigt werden. Bitte erneut an einem anderen Speicherort speichern. Die Änderungen bleiben ungesichert.")
            }
            ensureActive(upload)
            val displayName = try {
                resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                    val column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (column >= 0 && cursor.moveToFirst()) cursor.getString(column) else null
                }
            } catch (_: Exception) { null }
            val name = displayName?.takeIf { validDisplayName(it) } ?: upload.fileName
            ensureActive(upload)
            return PdfSaveResult("saved", name)
        } catch (error: SecurityException) {
            throw PdfSaveException("denied", "Android erlaubt das Schreiben oder Prüfen dieser PDF nicht. Bitte erneut einen anderen Speicherort auswählen. Die Änderungen bleiben ungesichert.")
        } catch (error: Exception) {
            if (error is PdfSaveException) throw error
            throw unavailable()
        } finally {
            synchronized(this) { discard(upload) }
        }
    }

    @Synchronized
    fun abort(token: String) {
        val upload = active ?: return
        if (upload.token != token) throw invalid()
        upload.cancelled.set(true)
        // An in-flight writer owns its stream and deletes the staging file in finally.
        if (upload.phase != Phase.WRITING && upload.phase != Phase.PREPARING) discard(upload)
    }

    @Synchronized
    override fun close() {
        closed = true
        active?.let { upload ->
            upload.cancelled.set(true)
            if (upload.phase != Phase.WRITING && upload.phase != Phase.PREPARING) discard(upload)
        }
    }

    private fun requireUpload(token: String, phase: Phase): Upload {
        if (closed) throw unavailable()
        val upload = active ?: throw invalid()
        if (upload.token != token || upload.phase != phase) throw invalid()
        return upload
    }

    private fun discard(upload: Upload) {
        try { upload.output?.close() } catch (_: IOException) { }
        upload.output = null
        upload.file.delete()
        if (active === upload) active = null
    }

    private fun ensureActive(upload: Upload) {
        if (upload.cancelled.get() || Thread.currentThread().isInterrupted) throw unavailable()
    }

    private fun removeOrphans(): Boolean = try {
        val files = directory.listFiles()
        if (files == null) !directory.exists()
        else files.filter { it.name.startsWith("pdf-export-") && it.isFile }
            .all { it.delete() || !it.exists() }
    } catch (_: SecurityException) { false }

    private fun digest(input: InputStream, expectedLength: Int, upload: Upload): ByteArray {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(IO_BUFFER_BYTES)
        var length = 0
        while (true) {
            ensureActive(upload)
            val count = input.read(buffer)
            if (count < 0) break
            if (count > expectedLength - length) throw verification()
            digest.update(buffer, 0, count)
            length += count
        }
        if (length != expectedLength) throw verification()
        return digest.digest()
    }

    private fun invalid() = PdfSaveException("invalid", "Der PDF-Speicherauftrag ist unvollständig oder ungültig. Bitte erneut speichern.")
    private fun unavailable() = PdfSaveException("unavailable", "Die PDF konnte nicht sicher gespeichert werden. Bitte Speicherplatz und Speicherort prüfen und erneut versuchen. Im Zielordner kann eine unvollständige Datei liegen; die Änderungen bleiben ungesichert.")
    private fun verification() = PdfSaveException("verification", "Die gespeicherte PDF ist unvollständig oder verändert. Bitte erneut an einem anderen Speicherort speichern. Die Änderungen bleiben ungesichert.")

    companion object {
        const val MAX_PDF_BYTES = 150 * 1024 * 1024
        const val MAX_CHUNK_BYTES = 256 * 1024
        private const val MAX_BASE64_LENGTH = 4 * ((MAX_CHUNK_BYTES + 2) / 3)
        private const val IO_BUFFER_BYTES = 64 * 1024
        private val PDF_HEADER = "%PDF-".toByteArray(Charsets.US_ASCII)

        private fun validDisplayName(value: String) = value.isNotBlank() && value.length <= 255 &&
            value.none { Character.isISOControl(it) || it == '/' || it == '\\' }

        private fun suggestedName(value: String): String {
            var name = value.substringAfterLast('/').substringAfterLast('\\')
                .map { if (Character.isISOControl(it) || it in ":*?\"<>|") '_' else it }.joinToString("")
                .trim().trim('.')
            if (name.isBlank()) name = "Dokument-annotiert.pdf"
            if (!name.endsWith(".pdf", ignoreCase = true)) name += ".pdf"
            if (name.length > 180) {
                name = name.take(176).let { if (it.last().isHighSurrogate()) it.dropLast(1) else it } + ".pdf"
            }
            return name
        }
    }
}
