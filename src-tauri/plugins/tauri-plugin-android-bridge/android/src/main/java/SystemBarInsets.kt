package io.github.roju0ch.pdfannotationeditor.androidbridge

import android.view.View
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import java.util.WeakHashMap

/** Keep native content inside system bars and cutouts without accumulating padding. */
internal class SystemBarInsets {
    private val originalPadding = WeakHashMap<View, Insets>()

    fun install(host: View) {
        val padding = originalPadding.getOrPut(host) {
            Insets.of(host.paddingLeft, host.paddingTop, host.paddingRight, host.paddingBottom)
        }
        val handled = WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
        ViewCompat.setOnApplyWindowInsetsListener(host) { view, insets ->
            val safe = insets.getInsets(handled)
            view.setPadding(
                padding.left + safe.left,
                padding.top + safe.top,
                padding.right + safe.right,
                padding.bottom + safe.bottom,
            )
            // The WebView must not apply the same safe area twice; unrelated
            // insets, including the software keyboard, still reach child views.
            WindowInsetsCompat.Builder(insets)
                .setDisplayCutout(null)
                .setInsets(handled, Insets.NONE)
                .setInsetsIgnoringVisibility(handled, Insets.NONE)
                .build()
        }
        ViewCompat.requestApplyInsets(host)
    }
}
