package io.github.roju0ch.pdfannotationeditor.androidbridge

import android.content.ClipboardManager
import android.content.Context
import androidx.appcompat.app.AppCompatActivity
import app.tauri.plugin.Invoke
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ClipboardTextCommandTest {
    @Test
    fun writeResolvesAfterPuttingPlainTextOnTheAndroidClipboard() {
        val activity = Robolectric.buildActivity(AppCompatActivity::class.java).get()
        val plugin = AndroidBridgePlugin(activity)
        val text = "Grüße & Öl\nZweite Zeile!"
        val manager = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        try {
            var response: Long? = null
            val send: (Long, String) -> Unit = { callback, _ -> response = callback }
            // Same SDK Invoke constructor as the import/save command tests.
            val mapper = Class.forName("com.fasterxml.jackson.databind.ObjectMapper").getConstructor().newInstance()
            val constructor = Invoke::class.java.declaredConstructors.single { it.parameterCount == 7 }
            val args = JSONObject().put("text", text).toString()
            val invoke = constructor.newInstance(1L, "writeClipboardText", 100L, 101L, send, args, mapper) as Invoke
            plugin.writeClipboardText(invoke)
            assertEquals(100L, response)
            val clip = manager.primaryClip!!
            assertEquals("text/plain", clip.description.getMimeType(0))
            assertEquals(text, clip.getItemAt(0).text.toString())
        } finally {
            plugin.onDestroy(activity)
        }
    }
}
