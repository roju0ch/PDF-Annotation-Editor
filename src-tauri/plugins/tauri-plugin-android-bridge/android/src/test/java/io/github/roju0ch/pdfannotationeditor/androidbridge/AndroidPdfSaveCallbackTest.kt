package io.github.roju0ch.pdfannotationeditor.androidbridge

import android.app.Activity
import android.content.Intent
import android.content.pm.ProviderInfo
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import androidx.activity.result.ActivityResult
import androidx.appcompat.app.AppCompatActivity
import app.tauri.plugin.Invoke
import java.io.File
import java.util.UUID
import java.util.concurrent.ExecutorService
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowContentResolver

/** Tests the actual plugin callback/Invoke boundary, without starting a WebView or Rust JNI.
 * SAF intent construction and ContentResolver failures have their own session tests.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AndroidPdfSaveCallbackTest {
    private lateinit var controller: ActivityController<HostActivity>
    private lateinit var activity: HostActivity
    private lateinit var plugin: AndroidBridgePlugin
    private lateinit var session: PdfSaveSession
    private lateinit var provider: PdfSaveSessionTest.PdfProvider
    private lateinit var providerDirectory: File

    @Before
    fun setUp() {
        controller = Robolectric.buildActivity(HostActivity::class.java).setup()
        activity = controller.get()
        providerDirectory = File(activity.cacheDir, "pdf-callback-test-${UUID.randomUUID()}").apply { mkdirs() }
        provider = PdfSaveSessionTest.PdfProvider().apply {
            file = File(providerDirectory, "chosen.pdf")
            displayName = "Bestätigter Plan.pdf"
        }
        provider.attachInfo(activity, ProviderInfo().apply { authority = AUTHORITY })
        ShadowContentResolver.registerProviderInternal(AUTHORITY, provider)
        plugin = AndroidBridgePlugin(activity)
        session = field("pdfSaves").get(plugin) as PdfSaveSession
    }

    @After
    fun tearDown() {
        if (::plugin.isInitialized) plugin.onDestroy(activity)
        if (::controller.isInitialized) controller.pause().stop().destroy()
        if (::providerDirectory.isInitialized) providerDirectory.deleteRecursively()
    }

    @Test
    fun savedCallbackResolvesExactlyOnceAfterRealWriteAndReadback() {
        val probe = Probe()
        installPending(upload(), probe.invoke)

        plugin.pdfSaveResult(probe.invoke, ActivityResult(Activity.RESULT_OK, Intent().setData(URI)))
        val reply = probe.awaitReply()
        assertEquals(SUCCESS_CALLBACK, reply.callback)
        assertEquals("saved", reply.json.getString("status"))
        assertEquals(provider.displayName, reply.json.getString("fileName"))
        assertArrayEquals(PDF, provider.file.readBytes())
        assertEquals(1, provider.writeOpens)
        assertTrue("Saved must require the provider read-back", provider.readOpens > 0)
        assertNull(pending().get())
        assertPrivateCacheEmpty()

        // A duplicate result cannot resolve twice or write the same URI again.
        plugin.pdfSaveResult(probe.invoke, ActivityResult(Activity.RESULT_OK, Intent().setData(URI)))
        awaitExecutor()
        assertTrue(probe.replies.isEmpty())
        assertEquals(1, provider.writeOpens)
    }

    @Test
    fun cancelledCallbackResolvesWithoutWritingOrLeavingAPendingSession() {
        val probe = Probe()
        installPending(upload(), probe.invoke)

        plugin.pdfSaveResult(probe.invoke, ActivityResult(Activity.RESULT_CANCELED, null))
        val reply = probe.awaitReply()
        assertEquals(SUCCESS_CALLBACK, reply.callback)
        assertEquals("cancelled", reply.json.getString("status"))
        assertFalse(reply.json.has("fileName"))
        assertFalse(provider.file.exists())
        assertEquals(0, provider.writeOpens)
        assertNull(pending().get())
        assertPrivateCacheEmpty()

        plugin.pdfSaveResult(probe.invoke, ActivityResult(Activity.RESULT_OK, Intent().setData(URI)))
        awaitExecutor()
        assertTrue(probe.replies.isEmpty())
        assertEquals(0, provider.writeOpens)
        val next = session.begin("Weiterer Versuch.pdf", PDF.size)
        session.abort(next)
    }

    @Test
    fun providerFailureRejectsTheFinishInvokeAndReleasesThePendingCallback() {
        provider.denyWrite = true
        val probe = Probe()
        installPending(upload(), probe.invoke)

        plugin.pdfSaveResult(probe.invoke, ActivityResult(Activity.RESULT_OK, Intent().setData(URI)))
        val reply = probe.awaitReply()
        assertEquals(ERROR_CALLBACK, reply.callback)
        assertEquals("denied", reply.json.getString("code"))
        assertFalse(reply.json.getString("message").isBlank())
        assertFalse(reply.json.has("status"))
        assertFalse(reply.json.toString().contains(AUTHORITY))
        assertFalse(reply.json.toString().contains(activity.cacheDir.path))
        assertFalse(provider.file.exists())
        assertNull(pending().get())
        assertPrivateCacheEmpty()

        // Failure does not strand a busy token and prevent a later retry.
        val next = session.begin("Erneuter Versuch.pdf", PDF.size)
        session.abort(next)
    }

    @Test
    fun activityDestructionRejectsOutstandingFinishAndIgnoresItsLateResult() {
        val probe = Probe()
        installPending(upload(), probe.invoke)

        plugin.onDestroy(activity)
        val reply = probe.awaitReply()
        assertEquals(ERROR_CALLBACK, reply.callback)
        assertEquals("unavailable", reply.json.getString("code"))
        assertTrue(reply.json.getString("message").contains("ungesichert"))
        assertNull(pending().get())
        assertPrivateCacheEmpty()

        plugin.pdfSaveResult(probe.invoke, ActivityResult(Activity.RESULT_OK, Intent().setData(URI)))
        assertTrue(probe.replies.isEmpty())
        assertEquals(0, provider.writeOpens)
        val later = Probe()
        plugin.beginPdfSave(later.invoke)
        assertEquals(ERROR_CALLBACK, later.awaitReply().callback)
    }

    @Test
    fun aDifferentInvokeCannotConsumeTheCurrentPickersResult() {
        val owner = Probe()
        val other = Probe()
        installPending(upload(), owner.invoke)

        // Even identical callback IDs do not make a different Invoke its owner.
        plugin.pdfSaveResult(other.invoke, ActivityResult(Activity.RESULT_CANCELED, null))
        assertNotNull(pending().get())
        assertTrue(owner.replies.isEmpty())
        assertTrue(other.replies.isEmpty())
        assertEquals(0, provider.writeOpens)

        plugin.pdfSaveResult(owner.invoke, ActivityResult(Activity.RESULT_CANCELED, null))
        assertEquals("cancelled", owner.awaitReply().json.getString("status"))
        assertNull(pending().get())
        assertTrue(other.replies.isEmpty())
    }

    private fun upload(): String {
        val token = session.begin("Plan-annotiert.pdf", PDF.size)
        assertEquals(PDF.size, session.append(token, 0, Base64.encodeToString(PDF, Base64.NO_WRAP)))
        session.prepare(token)
        return token
    }

    private fun installPending(token: String, invoke: Invoke) {
        val type = AndroidBridgePlugin::class.java.declaredClasses.single { it.simpleName == "PendingPdfSave" }
        val constructor = type.getDeclaredConstructor(String::class.java, Invoke::class.java).apply { isAccessible = true }
        pending().set(constructor.newInstance(token, invoke))
    }

    @Suppress("UNCHECKED_CAST")
    private fun pending() = field("pendingPdfSave").get(plugin) as AtomicReference<Any?>

    private fun field(name: String) = AndroidBridgePlugin::class.java.getDeclaredField(name).apply { isAccessible = true }

    private fun awaitExecutor() {
        (field("executor").get(plugin) as ExecutorService).submit { }.get(5, TimeUnit.SECONDS)
    }

    private fun assertPrivateCacheEmpty() {
        assertTrue(File(activity.cacheDir, "pdf-exports").walkTopDown().none { it.isFile })
    }

    class HostActivity : AppCompatActivity() {
        override fun onCreate(savedInstanceState: Bundle?) {
            setTheme(androidx.appcompat.R.style.Theme_AppCompat)
            super.onCreate(savedInstanceState)
        }
    }

    private data class Reply(val callback: Long, val data: String) {
        val json: JSONObject get() = JSONObject(data)
    }

    private class Probe {
        val replies = LinkedBlockingQueue<Reply>()
        val invoke: Invoke

        init {
            val send: (Long, String) -> Unit = { callback, data -> replies.add(Reply(callback, data)); Unit }
            // Jackson is a runtime implementation dependency of tauri-android.
            // Reflection avoids adding a test-only direct dependency merely to
            // construct the real public Invoke, whose response callback we use.
            val mapper = Class.forName("com.fasterxml.jackson.databind.ObjectMapper").getConstructor().newInstance()
            val constructor = Invoke::class.java.declaredConstructors.single { it.parameterCount == 7 }
            invoke = constructor.newInstance(1L, "finishPdfSave", SUCCESS_CALLBACK, ERROR_CALLBACK, send, "{}", mapper) as Invoke
        }

        fun awaitReply(): Reply {
            val reply = replies.poll(5, TimeUnit.SECONDS)
            assertNotNull("The plugin must finish its pending Invoke", reply)
            return reply!!
        }
    }

    companion object {
        private const val SUCCESS_CALLBACK = 100L
        private const val ERROR_CALLBACK = 101L
        private const val AUTHORITY = "io.github.roju0ch.pdfannotationeditor.pdf-save-callback-test"
        private val URI = Uri.parse("content://$AUTHORITY/chosen-document")
        private val PDF = "%PDF-1.7\nSynthetic PDF callback bytes\n%%EOF\n".toByteArray()
    }
}
