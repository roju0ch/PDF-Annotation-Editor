package io.github.roju0ch.pdfannotationeditor.androidbridge

import android.app.Activity
import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.ProviderInfo
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import android.util.Base64
import java.io.File
import java.io.FileNotFoundException
import java.util.UUID
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowContentResolver

/** Native streams and provider failures are exercised through Android's ContentResolver. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class PdfSaveSessionTest {
    private lateinit var context: Context
    private lateinit var cacheRoot: File
    private lateinit var provider: PdfProvider
    private lateinit var session: PdfSaveSession

    @Before
    fun setUp() {
        context = RuntimeEnvironment.getApplication()
        cacheRoot = File(context.cacheDir, "pdf-save-test-${UUID.randomUUID()}").apply { mkdirs() }
        provider = PdfProvider().apply { file = File(cacheRoot, "chosen-document.pdf") }
        provider.attachInfo(context, ProviderInfo().apply { authority = AUTHORITY })
        ShadowContentResolver.registerProviderInternal(AUTHORITY, provider)
        session = PdfSaveSession(cacheRoot, context.contentResolver)
    }

    @After
    fun tearDown() {
        session.close()
        cacheRoot.deleteRecursively()
    }

    @Test
    fun storagePickerRequestsANewPdfDocumentWithTheSuggestedName() {
        val token = upload(PDF)
        val intent = session.prepare(token)
        assertEquals(Intent.ACTION_CREATE_DOCUMENT, intent.action)
        assertTrue(intent.hasCategory(Intent.CATEGORY_OPENABLE))
        assertEquals("application/pdf", intent.type)
        assertEquals("Plan-annotiert.pdf", intent.getStringExtra(Intent.EXTRA_TITLE))
        assertNull("The app must let Android choose the destination", intent.data)
        assertNull("The app must not force a provider", intent.component)
        assertEquals(0, provider.writeOpens)
        assertEquals(0, provider.readOpens)
    }

    @Test
    fun aSuggestedNameCannotBecomeAnAppPrivateFilePath() {
        val token = session.begin("../../secret\\path\u0000\nPlan.pdf", PDF.size)
        session.append(token, 0, encoded(PDF))
        val title = session.prepare(token).getStringExtra(Intent.EXTRA_TITLE)!!
        assertTrue(title.endsWith(".pdf"))
        assertFalse(title.contains('/'))
        assertFalse(title.contains('\\'))
        assertFalse(title.any { it.code < 32 })
    }

    @Test
    fun chosenDocumentIsWrittenClosedAndReadBackBeforeReportingSuccess() {
        val token = upload(PDF)
        session.prepare(token)
        val result = session.finish(token, Activity.RESULT_OK, Intent().setData(URI))
        assertEquals("saved", result.status)
        assertEquals(provider.displayName, result.fileName)
        assertArrayEquals(PDF, provider.file.readBytes())
        assertEquals(1, provider.writeOpens)
        assertTrue("Success requires a read-back verification", provider.readOpens > 0)
        assertPrivateCacheEmpty()
    }

    @Test
    fun multipleBoundedChunksPreserveEveryByteIncludingBinaryPdfData() {
        val payload = ByteArray(CHUNK_BYTES * 2 + 913) { (it % 251).toByte() }
        "%PDF-1.7\n".toByteArray().copyInto(payload)
        val token = upload(payload)
        session.prepare(token)
        val result = session.finish(token, Activity.RESULT_OK, Intent().setData(URI))
        assertEquals("saved", result.status)
        assertArrayEquals(payload, provider.file.readBytes())
        assertPrivateCacheEmpty()
    }

    @Test
    fun pickerCancellationWritesNothingAndReleasesTheSession() {
        val token = upload(PDF)
        session.prepare(token)
        val result = session.finish(token, Activity.RESULT_CANCELED, null)
        assertEquals("cancelled", result.status)
        assertEquals(0, provider.writeOpens)
        assertFalse(provider.file.exists())
        assertPrivateCacheEmpty()
        val next = session.begin("Nochmals.pdf", PDF.size)
        session.abort(next)
    }

    @Test
    fun nullResultUriDoesNotPretendThatACancelOrSaveHappened() {
        val token = upload(PDF)
        session.prepare(token)
        assertFailure { session.finish(token, Activity.RESULT_OK, Intent()) }
        assertEquals(0, provider.writeOpens)
        assertPrivateCacheEmpty()
    }

    @Test
    fun fileAndNetworkUrisCannotBypassTheDocumentProviderBoundary() {
        for (uri in listOf("file:///sdcard/private.pdf", "https://example.invalid/pdf", "ftp://example.invalid/pdf")) {
            val token = upload(PDF)
            session.prepare(token)
            assertFailure { session.finish(token, Activity.RESULT_OK, Intent().setData(Uri.parse(uri))) }
            assertPrivateCacheEmpty()
        }
        assertEquals(0, provider.writeOpens)
    }

    @Test
    fun revokedWritePermissionIsAnErrorAndDoesNotReportSaved() {
        provider.denyWrite = true
        val token = upload(PDF)
        session.prepare(token)
        assertFailure { session.finish(token, Activity.RESULT_OK, Intent().setData(URI)) }
        assertFalse(provider.file.exists())
        assertPrivateCacheEmpty()
    }

    @Test
    fun providerWriteFailureIsActionableAndReleasesPrivateData() {
        provider.failWrite = true
        val token = upload(PDF)
        session.prepare(token)
        assertFailure { session.finish(token, Activity.RESULT_OK, Intent().setData(URI)) }
        assertPrivateCacheEmpty()
    }

    @Test
    fun anUnavailableOutputStreamCannotBeAcknowledgedAsSaved() {
        provider.nullWrite = true
        val token = upload(PDF)
        session.prepare(token)
        assertFailure { session.finish(token, Activity.RESULT_OK, Intent().setData(URI)) }
        assertPrivateCacheEmpty()
    }

    @Test
    fun readPermissionFailureAfterWritingStillDoesNotReportVerifiedSuccess() {
        provider.denyRead = true
        val token = upload(PDF)
        session.prepare(token)
        assertFailure { session.finish(token, Activity.RESULT_OK, Intent().setData(URI)) }
        assertTrue("A provider may have written a file, even when verification failed", provider.file.exists())
        assertPrivateCacheEmpty()
    }

    @Test
    fun truncatedProviderReadBackIsRejected() {
        provider.truncateOnRead = true
        val token = upload(PDF)
        session.prepare(token)
        assertFailure { session.finish(token, Activity.RESULT_OK, Intent().setData(URI)) }
        assertTrue(provider.readOpens > 0)
        assertPrivateCacheEmpty()
    }

    @Test
    fun changedBytesWithTheSameLengthAreRejectedByDigestVerification() {
        provider.corruptOnRead = true
        val token = upload(PDF)
        session.prepare(token)
        assertFailure { session.finish(token, Activity.RESULT_OK, Intent().setData(URI)) }
        assertEquals(PDF.size.toLong(), provider.file.length())
        assertPrivateCacheEmpty()
    }

    @Test
    fun missingDisplayNameFallsBackToTheSuggestedFilename() {
        provider.displayName = null
        val token = upload(PDF)
        session.prepare(token)
        assertEquals("Plan-annotiert.pdf", session.finish(token, Activity.RESULT_OK, Intent().setData(URI)).fileName)
    }

    @Test
    fun declaredLengthIsBoundedBeforeReceivingPdfBytes() {
        for (size in listOf(-1, 0, 4, MAX_PDF_BYTES + 1)) {
            assertFailure { session.begin("Plan.pdf", size) }
        }
        assertPrivateCacheEmpty()
        val token = session.begin("Groß.pdf", MAX_PDF_BYTES)
        session.abort(token)
        assertPrivateCacheEmpty()
    }

    @Test
    fun aSecondSaveCannotReplaceAnActiveUpload() {
        val token = session.begin("Plan-annotiert.pdf", PDF.size)
        assertFailure { session.begin("Andere Datei.pdf", PDF.size) }
        assertEquals(PDF.size, session.append(token, 0, encoded(PDF)))
        session.prepare(token)
        assertFailure { session.begin("Während der Ordnerwahl.pdf", PDF.size) }
        assertEquals("saved", session.finish(token, Activity.RESULT_OK, Intent().setData(URI)).status)
        assertArrayEquals(PDF, provider.file.readBytes())
    }

    @Test
    fun aForeignTokenCannotWriteAbortOrFinishAnotherUpload() {
        val token = session.begin("Plan-annotiert.pdf", PDF.size)
        assertFailure { session.append("not-the-session", 0, encoded(PDF)) }
        // Abort may reject or be idempotent, but it must not clobber the active session.
        try { session.abort("not-the-session") } catch (_: PdfSaveException) { }
        assertEquals(PDF.size, session.append(token, 0, encoded(PDF)))
        session.prepare(token)
        assertFailure { session.finish("not-the-session", Activity.RESULT_CANCELED, null) }
        assertEquals("saved", session.finish(token, Activity.RESULT_OK, Intent().setData(URI)).status)
    }

    @Test
    fun malformedOutOfOrderAndOversizedChunksAreRejected() {
        val cases = listOf<Pair<Int, String>>(
            1 to encoded(PDF),
            0 to "!this is not base64!",
            0 to "",
            0 to encoded(ByteArray(CHUNK_BYTES + 1)),
            0 to encoded(PDF + byteArrayOf(0)),
        )
        for ((offset, base64) in cases) {
            val token = session.begin("Plan.pdf", PDF.size)
            assertFailure { session.append(token, offset, base64) }
            try { session.abort(token) } catch (_: PdfSaveException) { }
            assertPrivateCacheEmpty()
        }
    }

    @Test
    fun eachChunkIsBoundedEvenWhenTheDeclaredPdfIsMuchLarger() {
        val token = session.begin("Großer Plan.pdf", CHUNK_BYTES * 3)
        assertFailure { session.append(token, 0, encoded(ByteArray(CHUNK_BYTES + 1))) }
        try { session.abort(token) } catch (_: PdfSaveException) { }
        assertPrivateCacheEmpty()
    }

    @Test
    fun repeatedChunkOffsetsCannotSilentlyDuplicateData() {
        val token = session.begin("Plan.pdf", PDF.size)
        val first = PDF.copyOfRange(0, 6)
        assertEquals(6, session.append(token, 0, encoded(first)))
        assertFailure { session.append(token, 0, encoded(first)) }
        try { session.abort(token) } catch (_: PdfSaveException) { }
        assertPrivateCacheEmpty()
    }

    @Test
    fun incompleteOrNonPdfUploadsCannotOpenTheStoragePicker() {
        var token = session.begin("Plan.pdf", PDF.size)
        session.append(token, 0, encoded(PDF.copyOfRange(0, 5)))
        assertFailure { session.prepare(token) }
        try { session.abort(token) } catch (_: PdfSaveException) { }
        assertPrivateCacheEmpty()
        token = upload("not a PDF document".toByteArray())
        assertFailure { session.prepare(token) }
        try { session.abort(token) } catch (_: PdfSaveException) { }
        assertPrivateCacheEmpty()
        assertEquals(0, provider.writeOpens)
    }

    @Test
    fun abortAndLifecycleCloseDeletePrivateStagingFiles() {
        val token = upload(PDF)
        assertTrue(privateFiles().isNotEmpty())
        session.abort(token)
        assertPrivateCacheEmpty()
        upload(PDF)
        session.close()
        assertPrivateCacheEmpty()
        assertFailure { session.begin("Nach Ende.pdf", PDF.size) }
    }

    @Test
    fun startupRemovesOrphanedExportsWithoutTouchingOtherCacheFiles() {
        session.close()
        val directory = File(cacheRoot, "pdf-exports").apply { mkdirs() }
        File(directory, "pdf-export-interrupted.tmp").writeBytes(PDF)
        val unrelated = File(cacheRoot, "unrelated-cache").apply { writeText("keep") }
        session = PdfSaveSession(cacheRoot, context.contentResolver)
        assertPrivateCacheEmpty()
        assertEquals("keep", unrelated.readText())
    }

    private fun upload(bytes: ByteArray): String {
        val token = session.begin("Plan-annotiert.pdf", bytes.size)
        var offset = 0
        while (offset < bytes.size) {
            val end = minOf(bytes.size, offset + CHUNK_BYTES)
            assertEquals(end, session.append(token, offset, encoded(bytes.copyOfRange(offset, end))))
            offset = end
        }
        return token
    }

    private fun encoded(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.NO_WRAP)

    private fun assertFailure(action: () -> Unit): PdfSaveException {
        val error = assertThrows(PdfSaveException::class.java) { action() }
        assertFalse(error.message.isNullOrBlank())
        assertFalse("Never expose provider URIs in a UI error", error.message!!.contains(AUTHORITY))
        assertFalse("Never expose app-private paths in a UI error", error.message!!.contains(cacheRoot.path))
        return error
    }

    private fun privateFiles() = File(cacheRoot, "pdf-exports").walkTopDown().filter { it.isFile }.toList()
    private fun assertPrivateCacheEmpty() = assertTrue("Private PDF staging files must be released", privateFiles().isEmpty())

    class PdfProvider : ContentProvider() {
        lateinit var file: File
        var displayName: String? = "Gespeicherter Plan.pdf"
        var denyWrite = false
        var denyRead = false
        var failWrite = false
        var nullWrite = false
        var truncateOnRead = false
        var corruptOnRead = false
        var readOpens = 0
        var writeOpens = 0

        override fun onCreate() = true
        override fun getType(uri: Uri) = "application/pdf"

        override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor? {
            if (mode.contains("w")) {
                if (denyWrite) throw SecurityException("Synthetic grant revoked")
                if (failWrite) throw FileNotFoundException("Synthetic storage unavailable")
                if (nullWrite) return null
                writeOpens++
                return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_CREATE or ParcelFileDescriptor.MODE_TRUNCATE or ParcelFileDescriptor.MODE_WRITE_ONLY)
            }
            if (denyRead) throw SecurityException("Synthetic verification grant revoked")
            readOpens++
            if (truncateOnRead) file.writeBytes(file.readBytes().dropLast(3).toByteArray())
            if (corruptOnRead) file.writeBytes(file.readBytes().also { it[0] = (it[0].toInt() xor 1).toByte() })
            return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
        }

        override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor =
            MatrixCursor(arrayOf(OpenableColumns.DISPLAY_NAME)).apply { addRow(arrayOf<Any?>(displayName)) }

        override fun insert(uri: Uri, values: ContentValues?): Uri? = null
        override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0
        override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
    }

    companion object {
        private const val MAX_PDF_BYTES = 150 * 1024 * 1024
        private const val CHUNK_BYTES = 256 * 1024
        private const val AUTHORITY = "io.github.roju0ch.pdfannotationeditor.pdf-save-test"
        private val URI = Uri.parse("content://$AUTHORITY/chosen-document")
        private val PDF = "%PDF-1.7\nSynthetic PDF export bytes\n%%EOF\n".toByteArray()
    }
}
