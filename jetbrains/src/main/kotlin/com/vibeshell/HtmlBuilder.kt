package com.vibeshell

import java.io.File

/**
 * Turns the app's index.html into a JCEF-loadable document: adds a nonce to
 * the renderer scripts, injects the shared webview bridge (which auto-selects
 * the JetBrains transport), and swaps in a CSP that allows local file assets.
 *
 * The result is written next to index.html so the renderer/ paths (kept
 * relative) resolve against a file:// base URL, and a file:// URL is returned.
 */
object HtmlBuilder {
    fun buildFileUrl(home: File): String {
        val nonce = "vibejcef" + System.nanoTime().toString(36)
        var html = AppHome.indexHtml(home).readText()

        // Nonce every renderer script so the strict script-src accepts them.
        for (rel in listOf(
            "renderer/i18n.js", "renderer/chat.js", "renderer/app.js", "renderer/settings.js"
        )) {
            html = html.replace("src=\"$rel\"", "nonce=\"$nonce\" src=\"$rel\"")
        }

        val csp = "default-src 'none'; " +
            "img-src file: data: blob:; " +
            "style-src file: 'unsafe-inline'; " +
            "font-src file:; " +
            "script-src 'nonce-$nonce';"
        html = Regex(
            "<meta http-equiv=\"Content-Security-Policy\"[\\s\\S]*?/>"
        ).replace(html) { "<meta http-equiv=\"Content-Security-Policy\" content=\"$csp\" />" }

        val bridge = AppHome.bridgeJs(home).readText()
        html = html.replace("</head>", "<script nonce=\"$nonce\">$bridge</script>\n</head>")

        val out = File(home, ".vibeshell-jcef.html")
        out.writeText(html)
        return out.toURI().toString() // file:///.../.vibeshell-jcef.html
    }
}
