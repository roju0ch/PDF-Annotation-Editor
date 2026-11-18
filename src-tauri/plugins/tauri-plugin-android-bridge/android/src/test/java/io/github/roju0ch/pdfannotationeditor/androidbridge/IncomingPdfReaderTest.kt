package io.github.roju0ch.pdfannotationeditor.androidbridge

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.content.pm.ProviderInfo
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.File
import java.io.FileNotFoundException
import java.io.RandomAccessFile
import java.util.UUID
import org.junit.After
import org.junit.Assert.*
import org.junit.Assume.assumeFalse
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowContentResolver

/** Reads actual Android ContentResolver streams; no PDF bytes travel through Intent extras/JSON. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class IncomingPdfReaderTest {
    private lateinit var context: Context
    private lateinit var cacheRoot: File
    private lateinit var provider: IncomingProvider
    private lateinit var reader: IncomingPdfReader

    @Before
    fun setUp() {
        context = RuntimeEnvironment.getApplication()
        cacheRoot = File(context.cacheDir, "pdf-incoming-test-${UUID.randomUUID()}").apply { mkdirs() }
        provider = IncomingProvider().apply {
            file = File(cacheRoot, "provider-source.pdf").apply { writeBytes(PDF) }
        }
        provider.attachInfo(context, ProviderInfo().apply { authority = AUTHORITY })
        ShadowContentResolver.registerProviderInternal(AUTHORITY, provider)
        reader = IncomingPdfReader(cacheRoot, context.contentResolver)
    }

    @After
    fun tearDown() {
        reader.close()
        cacheRoot.deleteRecursively()
    }

    @Test
    fun grantedContentUriBecomesAnExactPrivateSnapshotWithUnicodeName() {
        provider.displayName = "29.10.2026 Planung HLKS – Erdgeschoss 💡.pdf"
        val staged = reader.stage(URI.toString())
        val file = File(staged.path)
        assertArrayEquals(PDF, file.readBytes())
        assertEquals(PDF.size.toLong(), staged.byteLength)
        assertEquals(provider.displayName, staged.fileName)
        assertEquals(File(cacheRoot, "pdf-incoming").canonicalFile, file.parentFile!!.canonicalFile)
        assertTrue(file.name.startsWith("pdf-incoming-"))
        assertTrue(file.name.endsWith(".tmp"))
        assertEquals(1, provider.readOpens)
        // A later source modification cannot alter what the React import receives.
        provider.file.writeBytes("changed".toByteArray())
        assertArrayEquals(PDF, file.readBytes())
        file.delete()
    }

    @Test
    fun authorizedLocalFileUrisKeepSpacesUnicodeAndLiteralPercentCharacters() {
        val source = File(cacheRoot, "Grundriss – Ä 100%.pdf").apply { writeBytes(PDF) }
        val uri = Uri.fromFile(source)
        for (local in listOf(uri, uri.buildUpon().authority("localhost").build())) {
            val staged = reader.stage(local.toString())
            assertEquals(source.name, staged.fileName)
            assertEquals(PDF.size.toLong(), staged.byteLength)
            assertArrayEquals(PDF, File(staged.path).readBytes())
            assertNotEquals(source.canonicalPath, File(staged.path).canonicalPath)
        }
        assertEquals(0, provider.readOpens)
    }

    @Test
    fun localFileWithoutExistingReadAccessRequestsAFreshAuthorizedOpen() {
        val source = File(cacheRoot, "nicht lesbar.pdf").apply { writeBytes(PDF) }
        try {
            assertTrue(source.setReadable(false, false))
            // Root-based development containers can bypass Unix file mode;
            // ordinary Android/CI users exercise the actual denial below.
            assumeFalse("The host process bypasses file read permissions", source.canRead())
            val error = failure { reader.stage(Uri.fromFile(source).toString()) }
            assertEquals("denied", error.code)
            assertTrue(error.message!!.contains("Öffnen mit"))
            assertFalse(error.message!!.contains(source.absolutePath))
            assertPrivateSnapshotsEmpty()
        } finally {
            source.setReadable(true, true)
        }
    }

    @Test
    fun missingLocalFileAndDirectoriesDoNotCreateFalseSnapshots() {
        for (source in listOf(File(cacheRoot, "missing.pdf"), cacheRoot)) {
            assertEquals("unavailable", failure { reader.stage(Uri.fromFile(source).toString()) }.code)
            assertPrivateSnapshotsEmpty()
        }
    }

    @Test
    fun unknownProviderLengthIsCountedFromTheStream() {
        provider.declaredSize = null
        val payload = ByteArray(64 * 1024 * 3 + 71) { (it % 251).toByte() }
        "%PDF-1.7\n".toByteArray().copyInto(payload)
        provider.file.writeBytes(payload)
        val staged = reader.stage(URI.toString())
        assertEquals(payload.size.toLong(), staged.byteLength)
        assertArrayEquals(payload, File(staged.path).readBytes())
    }

    @Test
    fun negativeOrStaleSmallMetadataDoesNotTruncateReadablePdfBytes() {
        for (size in listOf(-1L, 0L, 5L)) {
            provider.declaredSize = size
            val staged = reader.stage(URI.toString())
            assertArrayEquals(PDF, File(staged.path).readBytes())
            File(staged.path).delete()
        }
    }

    @Test
    fun missingMetadataUsesAnHonestGenericFileNameAndStillReads() {
        provider.queryFails = true
        val staged = reader.stage(URI.toString())
        assertEquals("Dokument.pdf", staged.fileName)
        assertArrayEquals(PDF, File(staged.path).readBytes())
    }

    @Test
    fun untrustedDisplayNameCannotBecomeAPathOrControlText() {
        provider.displayName = "../../secret\\Plan\u0000\nmit Abstand.pdf"
        val staged = reader.stage(URI.toString())
        assertEquals("Plan__mit Abstand.pdf", staged.fileName)
        assertFalse(staged.fileName.contains('/'))
        assertFalse(staged.fileName.contains('\\'))
        assertFalse(staged.fileName.any { it.isISOControl() })
        assertTrue(File(staged.path).parentFile!!.canonicalPath.startsWith(cacheRoot.canonicalPath))
    }

    @Test
    fun longDisplayNameIsBoundedWithoutBreakingASurrogatePair() {
        provider.displayName = "a".repeat(254) + "💡.pdf"
        val staged = reader.stage(URI.toString())
        assertEquals("a".repeat(254), staged.fileName)
    }

    @Test
    fun deniedGrantIsReportedWithoutProviderUrisOrPrivatePaths() {
        provider.denyRead = true
        val error = failure { reader.stage(URI.toString()) }
        assertEquals("denied", error.code)
        assertFalse(error.message!!.contains(AUTHORITY))
        assertFalse(error.message!!.contains(cacheRoot.absolutePath))
        assertPrivateSnapshotsEmpty()
    }

    @Test
    fun missingDocumentFailsWithoutAFalseOpenOrLeakedSnapshot() {
        provider.missing = true
        val error = failure { reader.stage(URI.toString()) }
        assertEquals("unavailable", error.code)
        assertFalse(error.message!!.contains(AUTHORITY))
        assertPrivateSnapshotsEmpty()
    }

    @Test
    fun networkRemoteFileAndMalformedUrisCannotBypassTheLocalBoundary() {
        for (uri in listOf("https://example.invalid/plan.pdf", "file://remote.invalid/plan.pdf", "file://user@localhost/plan.pdf", "file://localhost:80/plan.pdf", "file:relative.pdf", "file:///plan.pdf?query=1", "file:///plan.pdf#fragment", "content:/missing-authority", "", "ftp://example.invalid/plan.pdf")) {
            assertEquals("invalid", failure { reader.stage(uri) }.code)
        }
        assertEquals(0, provider.readOpens)
        assertPrivateSnapshotsEmpty()
    }

    @Test
    fun advertisedOversizeIsRejectedBeforeOpeningTheProvider() {
        provider.declaredSize = IncomingPdfReader.MAX_PDF_BYTES + 1
        assertEquals("too-large", failure { reader.stage(URI.toString()) }.code)
        assertEquals(0, provider.readOpens)
        assertPrivateSnapshotsEmpty()
    }

    @Test
    fun unknownLengthCannotExceedTheActualHundredMiBLimit() {
        provider.declaredSize = null
        RandomAccessFile(provider.file, "rw").use { it.setLength(IncomingPdfReader.MAX_PDF_BYTES + 1) }
        assertEquals("too-large", failure { reader.stage(URI.toString()) }.code)
        assertPrivateSnapshotsEmpty()
    }

    @Test
    fun invalidAndEmptyStreamsAreRejectedAndTheirPrivateFilesRemoved() {
        for (bytes in listOf(byteArrayOf(), byteArrayOf(1, 2, 3, 4), "This is not a PDF".toByteArray(), ByteArray(4000))) {
            provider.file.writeBytes(bytes)
            assertEquals("invalid", failure { reader.stage(URI.toString()) }.code)
            assertPrivateSnapshotsEmpty()
        }
    }

    @Test
    fun headerPreambleMatchesTheExistingFrontendImportPolicy() {
        val payload = ByteArray(1024 + 128) { 32 }
        "%PDF-1.7\n".toByteArray().copyInto(payload, 1000)
        provider.file.writeBytes(payload)
        val staged = reader.stage(URI.toString())
        assertArrayEquals(payload, File(staged.path).readBytes())
    }

    @Test
    fun headerOutsideTheFirstKilobyteIsNotAcceptedAsPdf() {
        val payload = ByteArray(2200) { 32 }
        "%PDF-1.7\n".toByteArray().copyInto(payload, 1100)
        provider.file.writeBytes(payload)
        assertEquals("invalid", failure { reader.stage(URI.toString()) }.code)
        assertPrivateSnapshotsEmpty()
    }

    @Test
    fun closingTheActivityStopsFurtherReadsWithoutDeletingQueueOwnedFiles() {
        val staged = reader.stage(URI.toString())
        reader.close()
        assertEquals("interrupted", failure { reader.stage(URI.toString()) }.code)
        assertEquals(1, provider.readOpens)
        assertArrayEquals(PDF, File(staged.path).readBytes())
    }

    @Test
    fun aFailedOpenDoesNotPreventTheNextAuthorizedDocument() {
        provider.denyRead = true
        assertEquals("denied", failure { reader.stage(URI.toString()) }.code)
        provider.denyRead = false
        val staged = reader.stage(URI.toString())
        assertArrayEquals(PDF, File(staged.path).readBytes())
        assertEquals(2, provider.readOpens)
    }

    private fun failure(block: () -> Unit): PdfImportException {
        try {
            block()
            fail("The provider must not be reported as opened")
        } catch (error: PdfImportException) {
            return error
        }
        throw AssertionError("Expected PdfImportException")
    }

    private fun assertPrivateSnapshotsEmpty() {
        assertTrue(File(cacheRoot, "pdf-incoming").listFiles().orEmpty().isEmpty())
    }

    class IncomingProvider : ContentProvider() {
        lateinit var file: File
        var displayName: String? = "Grundriss.pdf"
        var declaredSize: Long? = null
        var queryFails = false
        var denyRead = false
        var missing = false
        var readOpens = 0
        override fun onCreate() = true
        override fun getType(uri: Uri) = "application/pdf"
        override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor {
            if (queryFails) throw SecurityException("Private provider metadata: $uri")
            return MatrixCursor(arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)).apply {
                addRow(arrayOf(displayName, declaredSize))
            }
        }
        override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
            readOpens++
            if (denyRead) throw SecurityException("Private provider URI: $uri")
            if (missing) throw FileNotFoundException("Private source: ${file.absolutePath}")
            if (mode != "r") throw SecurityException("Import may never write to the original")
            return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
        }
        override fun insert(uri: Uri, values: ContentValues?): Uri? = null
        override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
        override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0
    }

    companion object {
        private const val AUTHORITY = "pdf-incoming-tests.invalid"
        private val URI = Uri.parse("content://$AUTHORITY/document/plan%20mit%20Abstand.pdf")
        private val PDF = "%PDF-1.7\n1 0 obj <</Type/Catalog>> endobj\n%%EOF\n".toByteArray()
    }
}
