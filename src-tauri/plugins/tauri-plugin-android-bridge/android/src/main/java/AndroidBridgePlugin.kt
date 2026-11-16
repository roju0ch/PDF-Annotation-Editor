package io.github.roju0ch.pdfannotationeditor.androidbridge

import android.app.Activity
import android.content.ClipboardManager
import android.content.Context
import android.view.View
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean

@TauriPlugin
class AndroidBridgePlugin(private val activity: Activity) : Plugin(activity) {
    private val reader = ClipboardImageReader(activity.contentResolver)
    private val executor = Executors.newSingleThreadExecutor()
    private val reading = AtomicBoolean(false)
    private val systemBarInsets = SystemBarInsets()

    override fun load(webView: WebView) {
        // Android 15 enforces edge-to-edge: resize the actual WebView host rather
        // than guessing status-bar heights in CSS. Rotation and cutouts dispatch
        // new insets automatically, including landscape side navigation bars.
        systemBarInsets.install(activity.findViewById<View>(android.R.id.content))
    }

    @Command
    fun readClipboardImage(invoke: Invoke) {
        // Android permits reading the clipboard only while this app is focused.
        // This is never called from resume/load or a clipboard-change listener.
        activity.runOnUiThread {
            if (!activity.hasWindowFocus()) {
                invoke.reject("Bitte die App im Vordergrund öffnen und erneut einfügen.", "denied")
                return@runOnUiThread
            }
            if (!reading.compareAndSet(false, true)) {
                invoke.reject("Ein Bild wird bereits aus der Zwischenablage gelesen.", "busy")
                return@runOnUiThread
            }
            val clip = try {
                val manager = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                manager.primaryClip
            } catch (_: SecurityException) {
                reading.set(false)
                invoke.reject("Android erlaubt den Zugriff auf dieses Bild nicht. Bitte erneut kopieren oder ‚Bild einfügen …‘ verwenden.", "denied")
                return@runOnUiThread
            }
            try {
                executor.execute {
                    try {
                        val image = reader.read(clip)
                        val result = JSObject()
                        result.put("mimeType", image.mimeType)
                        result.put("base64", image.base64)
                        invoke.resolve(result)
                    } catch (error: ClipboardReadException) {
                        invoke.reject(error.message, error.code)
                    } catch (_: Exception) {
                        // Never log a content URI, clipboard data or provider exception.
                        invoke.reject("Das Bild konnte nicht gelesen werden. Bitte erneut kopieren oder ‚Bild einfügen …‘ verwenden.", "unavailable")
                    } finally {
                        reading.set(false)
                    }
                }
            } catch (_: RejectedExecutionException) {
                reading.set(false)
                invoke.reject("Die Zwischenablage ist momentan nicht verfügbar. Bitte erneut versuchen.", "unavailable")
            }
        }
    }

    override fun onDestroy(activity: AppCompatActivity) {
        executor.shutdownNow()
    }
}
