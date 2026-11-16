package io.github.roju0ch.pdfannotationeditor.androidbridge

import android.content.ClipData
import android.content.ContentResolver
import android.graphics.BitmapFactory
import android.util.Base64
import java.io.ByteArrayOutputStream
import java.io.IOException

internal data class ClipboardImage(val mimeType: String, val base64: String)

internal class ClipboardReadException(
    val code: String,
    override val message: String,
) : Exception(message)

/** Reads only granted local content. No URL loading or storage permissions. */
internal class ClipboardImageReader(private val resolver: ContentResolver) {
    companion object {
        const val MAX_BYTES = 20 * 1024 * 1024
        const val MAX_PIXELS = 20_000_000L
        const val MAX_SIDE = 16_384
    }

    fun read(clip: ClipData?): ClipboardImage {
        try {
            return readClip(clip)
        } catch (error: ClipboardReadException) {
            throw error
        } catch (_: SecurityException) {
            throw ClipboardReadException(
                "denied",
                "Android erlaubt den Zugriff auf dieses Bild nicht mehr. Bitte den Screenshot erneut kopieren oder ‚Bild einfügen …‘ verwenden.",
            )
        } catch (_: IOException) {
            throw ClipboardReadException(
                "unavailable",
                "Das Bild aus der Zwischenablage konnte nicht gelesen werden. Bitte erneut kopieren oder ‚Bild einfügen …‘ verwenden.",
            )
        }
    }

    private fun readClip(clip: ClipData?): ClipboardImage {
        if (clip == null || clip.itemCount == 0) noImage()
        // A copied image is normally a single item. Bound iteration for hostile providers.
        val uri = (0 until minOf(clip.itemCount, 32))
            .mapNotNull { clip.getItemAt(it).uri }
            .firstOrNull() ?: noImage()
        if (uri.scheme != ContentResolver.SCHEME_CONTENT) {
            throw ClipboardReadException(
                "unsupported-image",
                "Die Zwischenablage enthält keinen lokal freigegebenen Screenshot. Bitte ein PNG-/JPEG-Bild kopieren oder ‚Bild einfügen …‘ verwenden.",
            )
        }
        val declaredType = resolver.getType(uri)?.lowercase()?.substringBefore(';')
        if (declaredType != null && declaredType !in setOf(
                "image/png", "image/jpeg", "image/jpg", "application/octet-stream",
            )) {
            throw ClipboardReadException(
                "unsupported-image",
                "Nur PNG- und JPEG-Bilder können aus der Zwischenablage eingefügt werden. Bitte ‚Bild einfügen …‘ verwenden.",
            )
        }
        val bytes = resolver.openInputStream(uri)?.use { input ->
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                if (output.size().toLong() + count > MAX_BYTES) {
                    throw ClipboardReadException("too-large", "Das Bild ist größer als 20 MB. Bitte vorher verkleinern.")
                }
                output.write(buffer, 0, count)
            }
            output.toByteArray()
        } ?: throw ClipboardReadException("unavailable", "Das Bild aus der Zwischenablage ist nicht mehr verfügbar. Bitte erneut kopieren.")

        // Read dimensions before allocating a bitmap. The existing PDF importer
        // validates and decodes the image itself after these bounded bytes cross IPC.
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
            throw ClipboardReadException("invalid-image", "Die Zwischenablage enthält keine gültige PNG- oder JPEG-Datei.")
        }
        if (bounds.outMimeType !in setOf("image/png", "image/jpeg")) {
            throw ClipboardReadException("unsupported-image", "Nur PNG- und JPEG-Bilder werden unterstützt.")
        }
        if (bounds.outWidth.toLong() * bounds.outHeight > MAX_PIXELS ||
            maxOf(bounds.outWidth, bounds.outHeight) > MAX_SIDE) {
            throw ClipboardReadException(
                "too-large",
                "Das Bild ist zu groß (maximal 20 Megapixel und 16.384 Pixel je Seite). Bitte vorher verkleinern.",
            )
        }
        return ClipboardImage(bounds.outMimeType, Base64.encodeToString(bytes, Base64.NO_WRAP))
    }

    private fun noImage(): Nothing = throw ClipboardReadException(
        "no-image",
        "Kein PNG-/JPEG-Bild in der Zwischenablage. Bitte einen Screenshot kopieren oder ‚Bild einfügen …‘ verwenden.",
    )
}
