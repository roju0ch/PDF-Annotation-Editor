package io.github.roju0ch.pdfannotationeditor.androidbridge

import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.content.pm.ProviderInfo
import android.database.Cursor
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.util.Base64
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileNotFoundException
import java.nio.ByteBuffer
import java.util.zip.CRC32
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowContentResolver

/** Exercise Android's actual ContentResolver and image bounds decoder, without a WebView mock. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ClipboardImageReaderTest {
    private lateinit var context: Context
    private lateinit var provider: ImageProvider
    private lateinit var reader: ClipboardImageReader

    @Before
    fun setUp() {
        context = RuntimeEnvironment.getApplication()
        provider = ImageProvider()
        provider.attachInfo(context, ProviderInfo().apply { authority = AUTHORITY })
        ShadowContentResolver.registerProviderInternal(AUTHORITY, provider)
        reader = ClipboardImageReader(context.contentResolver)
    }

    @Test
    fun pngClipboardUriPreservesOriginalBytes() {
        val bytes = picture(Bitmap.CompressFormat.PNG)
        val manager = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        manager.setPrimaryClip(clip(bytes, "image/png"))
        val image = reader.read(manager.primaryClip)
        assertEquals("image/png", image.mimeType)
        assertArrayEquals(bytes, Base64.decode(image.base64, Base64.DEFAULT))
        assertEquals(1, provider.opened)
    }

    @Test
    fun jpegClipboardUriPreservesOriginalBytes() {
        val bytes = picture(Bitmap.CompressFormat.JPEG)
        val manager = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        manager.setPrimaryClip(clip(bytes, "image/jpeg"))
        val image = reader.read(manager.primaryClip)
        assertEquals("image/jpeg", image.mimeType)
        assertArrayEquals(bytes, Base64.decode(image.base64, Base64.DEFAULT))
    }

    @Test
    fun octetStreamStillValidatesTheActualImageFormat() {
        val image = reader.read(clip(picture(Bitmap.CompressFormat.PNG), "application/octet-stream"))
        assertEquals("image/png", image.mimeType)
    }

    @Test
    fun missingProviderMimeStillValidatesTheImage() {
        val image = reader.read(clip(picture(Bitmap.CompressFormat.JPEG), null))
        assertEquals("image/jpeg", image.mimeType)
    }

    @Test
    fun emptyClipboardHasAnActionableError() {
        assertError(null, "no-image")
    }

    @Test
    fun textClipboardIsNotInterpretedAsAnImageOrUrl() {
        assertError(ClipData.newPlainText("Text", "https://example.org/screenshot.png"), "no-image")
        assertEquals(0, provider.opened)
    }

    @Test
    fun webUrisAreNeverDownloaded() {
        assertError(uriClip(Uri.parse("https://example.org/screenshot.png")), "unsupported-image")
        assertEquals(0, provider.opened)
    }

    @Test
    fun fileUrisCannotBypassTheContentResolverBoundary() {
        assertError(uriClip(Uri.parse("file:///sdcard/screenshot.png")), "unsupported-image")
        assertEquals(0, provider.opened)
    }

    @Test
    fun revokedUriPermissionHasAnActionableError() {
        provider.deny = true
        assertError(uriClip(URI), "denied")
    }

    @Test
    fun disappearingProviderFileDoesNotCrashTheBridge() {
        assertError(uriClip(URI), "unavailable")
    }

    @Test
    fun unsupportedProviderMimeIsRejectedBeforeOpening() {
        val clip = clip("<svg/>".toByteArray(), "image/svg+xml")
        assertError(clip, "unsupported-image")
        assertEquals(0, provider.opened)
    }

    @Test
    fun mislabeledNonImageCannotReachThePdfEngine() {
        assertError(clip("not an image".toByteArray(), "image/png"), "invalid-image")
    }

    @Test
    fun oversizedStreamIsRejectedRatherThanTransferredToJavascript() {
        assertError(clip(ByteArray(20 * 1024 * 1024 + 1), "image/png"), "too-large")
    }

    @Test
    fun excessiveImageSideIsRejectedBeforeAllocatingABitmap() {
        assertError(clip(pngWithDimensions(20000, 3), "image/png"), "too-large")
    }

    @Test
    fun excessivePixelCountIsRejectedBeforeAllocatingABitmap() {
        assertError(clip(pngWithDimensions(5000, 5000), "image/png"), "too-large")
    }

    private fun clip(bytes: ByteArray, mime: String?): ClipData {
        provider.mime = mime
        provider.file = File(context.cacheDir, "clipboard-image").apply { writeBytes(bytes) }
        return uriClip(URI)
    }

    private fun uriClip(uri: Uri) = ClipData("Screenshot", arrayOf("image/png"), ClipData.Item(uri))

    private fun assertError(clip: ClipData?, code: String) {
        val failure = assertThrows(ClipboardReadException::class.java) { reader.read(clip) }
        assertEquals(code, failure.code)
        assertFalse("The user needs an actionable message", failure.message.isNullOrBlank())
    }

    private fun picture(format: Bitmap.CompressFormat): ByteArray {
        val bitmap = Bitmap.createBitmap(4, 3, Bitmap.Config.ARGB_8888)
        return try {
            bitmap.eraseColor(Color.CYAN)
            ByteArrayOutputStream().use { output ->
                assertTrue(bitmap.compress(format, 90, output))
                output.toByteArray()
            }
        } finally {
            bitmap.recycle()
        }
    }

    /** Change only the PNG IHDR and its CRC; bounds decoding must reject these dimensions. */
    private fun pngWithDimensions(width: Int, height: Int): ByteArray {
        val bytes = picture(Bitmap.CompressFormat.PNG)
        ByteBuffer.wrap(bytes).apply { putInt(16, width); putInt(20, height) }
        val crc = CRC32().apply { update(bytes, 12, 17) }.value.toInt()
        ByteBuffer.wrap(bytes).putInt(29, crc)
        return bytes
    }

    class ImageProvider : ContentProvider() {
        var mime: String? = "image/png"
        var file: File? = null
        var deny = false
        var opened = 0

        override fun onCreate() = true
        override fun getType(uri: Uri): String? {
            if (deny) throw SecurityException("URI grant revoked")
            return mime
        }
        override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
            if (deny) throw SecurityException("URI grant revoked")
            opened++
            return ParcelFileDescriptor.open(file ?: throw FileNotFoundException("Image was removed"), ParcelFileDescriptor.MODE_READ_ONLY)
        }
        override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null
        override fun insert(uri: Uri, values: ContentValues?): Uri? = null
        override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0
        override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
    }

    companion object {
        private const val AUTHORITY = "io.github.roju0ch.pdfannotationeditor.clipboard-test"
        private val URI = Uri.parse("content://$AUTHORITY/screenshot")
    }
}
