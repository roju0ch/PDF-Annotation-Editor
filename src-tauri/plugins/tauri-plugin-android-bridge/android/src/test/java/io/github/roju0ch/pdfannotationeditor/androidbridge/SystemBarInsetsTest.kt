package io.github.roju0ch.pdfannotationeditor.androidbridge

import android.graphics.Rect
import android.view.View
import android.widget.FrameLayout
import androidx.core.graphics.Insets
import androidx.core.view.DisplayCutoutCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class SystemBarInsetsTest {
    @Test
    fun repeatedInstallationDoesNotAccumulateSystemBarPadding() {
        val host = host()
        val helper = SystemBarInsets()
        val systemBars = WindowInsetsCompat.Builder(insets(Insets.of(0, 24, 0, 18)))
            .setDisplayCutout(DisplayCutoutCompat(Rect(0, 32, 0, 0), listOf(Rect(100, 0, 200, 32))))
            .build()

        helper.install(host)
        ViewCompat.dispatchApplyWindowInsets(host, systemBars)
        assertPadding(host, Insets.of(3, 36, 5, 24))

        // Tauri may invoke Plugin.load() again for the same native content host.
        helper.install(host)
        ViewCompat.dispatchApplyWindowInsets(host, systemBars)
        assertPadding(host, Insets.of(3, 36, 5, 24))
    }

    @Test
    fun rotationReplacesInsetsAndPreservesTheSoftwareKeyboardForChildren() {
        val host = host()
        val helper = SystemBarInsets()
        helper.install(host)
        ViewCompat.dispatchApplyWindowInsets(host, insets(Insets.of(0, 24, 0, 18)))

        val keyboard = Insets.of(0, 0, 0, 240)
        val rotated = WindowInsetsCompat.Builder(insets(Insets.of(28, 0, 20, 0)))
            .setDisplayCutout(DisplayCutoutCompat(Rect(30, 0, 0, 0), listOf(Rect(0, 100, 30, 200))))
            .setInsets(WindowInsetsCompat.Type.ime(), keyboard)
            .setVisible(WindowInsetsCompat.Type.ime(), true)
            .build()
        val forwarded = ViewCompat.dispatchApplyWindowInsets(host, rotated)

        assertPadding(host, Insets.of(33, 4, 25, 6))
        assertEquals(Insets.NONE, forwarded.getInsets(WindowInsetsCompat.Type.systemBars()))
        assertEquals(Insets.NONE, forwarded.getInsets(WindowInsetsCompat.Type.displayCutout()))
        assertNull(forwarded.displayCutout)
        assertEquals(keyboard, forwarded.getInsets(WindowInsetsCompat.Type.ime()))
    }

    private fun host(): View = FrameLayout(RuntimeEnvironment.getApplication()).apply {
        setPadding(3, 4, 5, 6)
    }

    private fun insets(systemBars: Insets): WindowInsetsCompat = WindowInsetsCompat.Builder()
        .setInsets(WindowInsetsCompat.Type.systemBars(), systemBars)
        .setInsetsIgnoringVisibility(WindowInsetsCompat.Type.systemBars(), systemBars)
        .setVisible(WindowInsetsCompat.Type.systemBars(), true)
        .build()

    private fun assertPadding(view: View, expected: Insets) {
        assertEquals(expected.left, view.paddingLeft)
        assertEquals(expected.top, view.paddingTop)
        assertEquals(expected.right, view.paddingRight)
        assertEquals(expected.bottom, view.paddingBottom)
    }
}
