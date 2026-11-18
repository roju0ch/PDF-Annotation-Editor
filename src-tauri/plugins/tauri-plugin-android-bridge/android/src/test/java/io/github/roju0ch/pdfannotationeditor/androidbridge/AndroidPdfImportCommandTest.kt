package io.github.roju0ch.pdfannotationeditor.androidbridge

import android.content.pm.ProviderInfo
import android.net.Uri
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import app.tauri.plugin.Invoke
import java.io.File
import java.util.UUID
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
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

/** Exercises the real SDK Invoke argument/response boundary used only by native Rust. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AndroidPdfImportCommandTest {
    private lateinit var controller: ActivityController<HostActivity>
    private lateinit var activity: HostActivity
    private lateinit var plugin: AndroidBridgePlugin
    private lateinit var provider: IncomingPdfReaderTest.IncomingProvider
    private lateinit var sourceDirectory: File
    private val snapshots = mutableListOf<File>()

    @Before
    fun setUp() {
        controller = Robolectric.buildActivity(HostActivity::class.java).setup()
        activity = controller.get()
        sourceDirectory = File(activity.cacheDir, "pdf-import-command-${UUID.randomUUID()}").apply { mkdirs() }
        provider = IncomingPdfReaderTest.IncomingProvider().apply {
            file = File(sourceDirectory, "granted.pdf").apply { writeBytes(PDF) }
            displayName = "Plan mit Abstand – Ä.pdf"
        }
        provider.attachInfo(activity, ProviderInfo().apply { authority = AUTHORITY })
        ShadowContentResolver.registerProviderInternal(AUTHORITY, provider)
        plugin = AndroidBridgePlugin(activity)
    }

    @After
    fun tearDown() {
        if (::plugin.isInitialized) plugin.onDestroy(activity)
        if (::controller.isInitialized) controller.pause().stop().destroy()
        snapshots.forEach { it.delete() }
        if (::sourceDirectory.isInitialized) sourceDirectory.deleteRecursively()
    }

    @Test
    fun internalCommandResolvesOnlyAfterTheGrantedPdfHasBeenCopied() {
        val probe = Probe(URI.toString())
        plugin.stageIncomingPdf(probe.invoke)
        val reply = probe.awaitReply()
        assertEquals(SUCCESS_CALLBACK, reply.callback)
        val file = File(reply.json.getString("path")).also { snapshots.add(it) }
        assertArrayEquals(PDF, file.readBytes())
        assertEquals(PDF.size.toLong(), reply.json.getLong("byteLength"))
        assertEquals(provider.displayName, reply.json.getString("fileName"))
        assertEquals(File(activity.cacheDir, "pdf-incoming").canonicalFile, file.parentFile!!.canonicalFile)
        assertEquals(1, provider.readOpens)
    }

    @Test
    fun revokedContentGrantRejectsTheInvokeWithoutPrivateUris() {
        provider.denyRead = true
        val probe = Probe(URI.toString())
        plugin.stageIncomingPdf(probe.invoke)
        val reply = probe.awaitReply()
        assertEquals(ERROR_CALLBACK, reply.callback)
        assertEquals("denied", reply.json.getString("code"))
        assertFalse(reply.data.contains(AUTHORITY))
        assertFalse(reply.data.contains(sourceDirectory.absolutePath))
    }

    @Test
    fun remoteFileHostsAreNotAcceptedByTheInternalUriReader() {
        val probe = Probe("file://remote.invalid${provider.file.absolutePath}")
        plugin.stageIncomingPdf(probe.invoke)
        val reply = probe.awaitReply()
        assertEquals(ERROR_CALLBACK, reply.callback)
        assertEquals("invalid", reply.json.getString("code"))
        assertEquals(0, provider.readOpens)
    }

    @Test
    fun readableLocalFileUriUsesTheSamePrivateSnapshotResponse() {
        val probe = Probe(Uri.fromFile(provider.file).toString())
        plugin.stageIncomingPdf(probe.invoke)
        val reply = probe.awaitReply()
        assertEquals(SUCCESS_CALLBACK, reply.callback)
        val file = File(reply.json.getString("path")).also { snapshots.add(it) }
        assertArrayEquals(PDF, file.readBytes())
        assertEquals(provider.file.name, reply.json.getString("fileName"))
        assertEquals(PDF.size.toLong(), reply.json.getLong("byteLength"))
        assertEquals(0, provider.readOpens)
    }

    @Test
    fun aDestroyedActivityCannotStartAnotherProviderRead() {
        plugin.onDestroy(activity)
        val probe = Probe(URI.toString())
        plugin.stageIncomingPdf(probe.invoke)
        val reply = probe.awaitReply()
        assertEquals(ERROR_CALLBACK, reply.callback)
        assertEquals("interrupted", reply.json.getString("code"))
        assertEquals(0, provider.readOpens)
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

    private class Probe(uri: String) {
        private val replies = LinkedBlockingQueue<Reply>()
        val invoke: Invoke
        init {
            val send: (Long, String) -> Unit = { callback, data -> replies.add(Reply(callback, data)); Unit }
            val mapper = Class.forName("com.fasterxml.jackson.databind.ObjectMapper").getConstructor().newInstance()
            val constructor = Invoke::class.java.declaredConstructors.single { it.parameterCount == 7 }
            invoke = constructor.newInstance(1L, "stageIncomingPdf", SUCCESS_CALLBACK, ERROR_CALLBACK, send, JSONObject().put("uri", uri).toString(), mapper) as Invoke
        }
        fun awaitReply(): Reply {
            val reply = replies.poll(5, TimeUnit.SECONDS)
            assertNotNull("The native import command must finish its Invoke", reply)
            return reply!!
        }
    }

    companion object {
        private const val SUCCESS_CALLBACK = 100L
        private const val ERROR_CALLBACK = 101L
        private const val AUTHORITY = "pdf-import-command-tests.invalid"
        private val URI = Uri.parse("content://$AUTHORITY/document/plan%20mit%20Abstand.pdf")
        private val PDF = "%PDF-1.7\nSynthetic PDF import bytes\n%%EOF\n".toByteArray()
    }
}
