package io.github.roju0ch.pdfannotationeditor.androidbridge

import android.app.Activity
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Process
import android.provider.DocumentsContract
import android.content.Context
import android.content.ActivityNotFoundException
import android.view.View
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

@InvokeArg
class BeginPdfSaveArgs {
    var fileName: String = ""
    var byteLength: Int = 0
}

@InvokeArg
class AppendPdfSaveArgs {
    var token: String = ""
    var offset: Int = -1
    var base64: String = ""
}

@InvokeArg
class PdfSaveTokenArgs {
    var token: String = ""
    var initialUri: String? = null
}

@InvokeArg
class StageIncomingPdfArgs {
    var uri: String = ""
}

@TauriPlugin
class AndroidBridgePlugin(private val activity: Activity) : Plugin(activity) {
    private val reader = ClipboardImageReader(activity.contentResolver)
    private val executor = Executors.newSingleThreadExecutor()
    private val reading = AtomicBoolean(false)
    private val systemBarInsets = SystemBarInsets()
    private val pdfSaves = PdfSaveSession(activity.cacheDir, activity.contentResolver)
    private val pdfImports = IncomingPdfReader(activity.cacheDir, activity.contentResolver)
    private val destroyed = AtomicBoolean(false)
    private data class PendingPdfSave(val token: String, val invoke: Invoke)
    private val pendingPdfSave = AtomicReference<PendingPdfSave?>(null)

    override fun load(webView: WebView) {
        // Android 15 enforces edge-to-edge: resize the actual WebView host rather
        // than guessing status-bar heights in CSS. Rotation and cutouts dispatch
        // new insets automatically, including landscape side navigation bars.
        systemBarInsets.install(activity.findViewById<View>(android.R.id.content))
    }

    /** Rust-only command: the native OS-open queue supplies the granted URI.
     * It is deliberately absent from the JavaScript invoke handler/capabilities.
     * Tauri/tao delivers both initial ACTION_VIEW and onNewIntent through RunEvent::Opened.
     */
    @Command
    fun stageIncomingPdf(invoke: Invoke) {
        if (destroyed.get()) {
            invoke.reject("Das Öffnen der PDF wurde unterbrochen. Bitte die Datei erneut auswählen.", "interrupted")
            return
        }
        try {
            executor.execute {
                try {
                    val args = invoke.parseArgs(StageIncomingPdfArgs::class.java)
                    val staged = pdfImports.stage(args.uri)
                    invoke.resolve(JSObject().apply {
                        put("path", staged.path)
                        put("fileName", staged.fileName)
                        put("byteLength", staged.byteLength)
                    })
                } catch (error: PdfImportException) {
                    invoke.reject(error.message, error.code)
                } catch (_: Exception) {
                    invoke.reject("Die übergebene PDF konnte nicht gelesen werden. Bitte die Datei erneut über ‚Öffnen mit‘ auswählen.", "unavailable")
                }
            }
        } catch (_: RejectedExecutionException) {
            invoke.reject("Das Öffnen der PDF wurde unterbrochen. Bitte die Datei erneut auswählen.", "interrupted")
        }
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

    private fun saveTask(invoke: Invoke, task: () -> Unit) {
        if (destroyed.get()) {
            invoke.reject("Der Speichervorgang wurde unterbrochen. Die Änderungen bleiben ungesichert.", "unavailable")
            return
        }
        try {
            executor.execute {
                try {
                    if (destroyed.get()) throw PdfSaveException("unavailable", "Der Speichervorgang wurde unterbrochen. Die Änderungen bleiben ungesichert.")
                    task()
                } catch (error: PdfSaveException) {
                    invoke.reject(error.message, error.code)
                } catch (_: Exception) {
                    // Never expose provider exception text: it can contain private URIs/paths.
                    invoke.reject("Die PDF konnte nicht sicher gespeichert werden. Bitte Speicherplatz und Speicherort prüfen und erneut versuchen. Die Änderungen bleiben ungesichert.", "unavailable")
                }
            }
        } catch (_: RejectedExecutionException) {
            invoke.reject("Der Speichervorgang wurde unterbrochen. Die Änderungen bleiben ungesichert.", "unavailable")
        }
    }

    @Command
    fun beginPdfSave(invoke: Invoke) = saveTask(invoke) {
        if (pendingPdfSave.get() != null) throw PdfSaveException("busy", "Bitte zuerst den geöffneten Speicherdialog abschließen.")
        val args = invoke.parseArgs(BeginPdfSaveArgs::class.java)
        val token = pdfSaves.begin(args.fileName, args.byteLength)
        invoke.resolve(JSObject().apply { put("token", token) })
    }

    @Command
    fun appendPdfSave(invoke: Invoke) = saveTask(invoke) {
        val args = invoke.parseArgs(AppendPdfSaveArgs::class.java)
        val received = pdfSaves.append(args.token, args.offset, args.base64)
        invoke.resolve(JSObject().apply { put("received", received) })
    }

    @Command
    fun finishPdfSave(invoke: Invoke) = saveTask(invoke) {
        val args = invoke.parseArgs(PdfSaveTokenArgs::class.java)
        val intent = pdfSaves.prepare(args.token)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val initial = args.initialUri?.let(Uri::parse)
            if (initial?.scheme == "content" && runCatching {
                DocumentsContract.isDocumentUri(activity, initial) &&
                    activity.checkUriPermission(initial, Process.myPid(), Process.myUid(),
                        Intent.FLAG_GRANT_READ_URI_PERMISSION) == PackageManager.PERMISSION_GRANTED
            }.getOrDefault(false)) {
                intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, initial)
            }
        }
        val pending = PendingPdfSave(args.token, invoke)
        if (!pendingPdfSave.compareAndSet(null, pending)) {
            pdfSaves.abort(args.token)
            throw PdfSaveException("busy", "Bitte zuerst den geöffneten Speicherdialog abschließen.")
        }
        activity.runOnUiThread {
            if (pendingPdfSave.get() !== pending) return@runOnUiThread
            try {
                if (destroyed.get() || activity.isFinishing || activity.isDestroyed || !activity.hasWindowFocus()) {
                    throw IllegalStateException("App is not foreground")
                }
                startActivityForResult(invoke, intent, "pdfSaveResult")
            } catch (_: ActivityNotFoundException) {
                rejectPicker(pending, "Auf diesem Gerät konnte kein Android-Speicherdialog geöffnet werden. Die Änderungen bleiben ungesichert.")
            } catch (_: Exception) {
                rejectPicker(pending, "Der Speicherdialog konnte nicht geöffnet werden. Bitte die App im Vordergrund erneut öffnen und speichern. Die Änderungen bleiben ungesichert.")
            }
        }
    }

    private fun rejectPicker(pending: PendingPdfSave, message: String) {
        if (!pendingPdfSave.compareAndSet(pending, null)) return
        pdfSaves.abort(pending.token)
        pending.invoke.reject(message, "unavailable")
    }

    @ActivityCallback
    fun pdfSaveResult(invoke: Invoke, result: ActivityResult) {
        val pending = pendingPdfSave.get() ?: return
        if (pending.invoke !== invoke || !pendingPdfSave.compareAndSet(pending, null)) return
        saveTask(invoke) {
            val saved = pdfSaves.finish(pending.token, result.resultCode, result.data)
            invoke.resolve(JSObject().apply {
                put("status", saved.status)
                if (saved.fileName != null) {
                    put("fileName", saved.fileName)
                    // Native Rust retains this picker hint and omits it from the WebView reply.
                    put("uri", result.data?.data?.toString())
                }
            })
        }
    }

    @Command
    fun abortPdfSave(invoke: Invoke) = saveTask(invoke) {
        val args = invoke.parseArgs(PdfSaveTokenArgs::class.java)
        // Keep an outstanding picker owned until its result arrives; a later
        // transaction must never receive an earlier dialog's activity result.
        pdfSaves.abort(args.token)
        invoke.resolve(JSObject())
    }

    override fun onDestroy(activity: AppCompatActivity) {
        destroyed.set(true)
        pdfImports.close()
        pdfSaves.close()
        pendingPdfSave.getAndSet(null)?.invoke?.reject("Der Speichervorgang wurde unterbrochen. Die Änderungen bleiben ungesichert.", "unavailable")
        executor.shutdownNow()
    }
}
