package com.vibeshell

import com.intellij.openapi.Disposable
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefJSQuery
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLoadHandlerAdapter
import java.awt.BorderLayout
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.SwingConstants

/**
 * The VibeShell tool-window content: a JCEF browser running the same renderer
 * as the desktop app and the VS Code panel, bridged to the Node backend
 * sidecar. Messages flow:
 *   webview  --window.__vibeToJava(json)-->  JBCefJSQuery  -->  sidecar stdin
 *   sidecar stdout  -->  executeJavaScript(window.__vibeFromJava(json))  --> webview
 */
class VibeShellPanel(private val project: Project) : Disposable {

    val component: JComponent

    private var browser: JBCefBrowser? = null
    private var jsQuery: JBCefJSQuery? = null
    private var sidecar: Sidecar? = null

    @Volatile private var pageReady = false
    private val pendingToJs = ArrayList<String>()

    init {
        if (!JBCefApp.isSupported()) {
            component = JPanel(BorderLayout()).apply {
                add(JLabel("Embedded browser (JCEF) is not available in this IDE.", SwingConstants.CENTER))
            }
        } else {
            val home = AppHome.resolve()
            val b = JBCefBrowser()
            browser = b
            Disposer.register(this, b)

            val query = JBCefJSQuery.create(b as com.intellij.ui.jcef.JBCefBrowserBase)
            jsQuery = query

            // JS → Java: forward each webview invoke to the sidecar's stdin.
            query.addHandler { request ->
                sidecar?.send(request)
                null
            }

            // Java → JS: sidecar stdout → the webview bridge (buffered until load).
            // If it can't start (Node missing) or dies, tell the webview so it
            // shows a clear banner instead of a frozen spinner.
            val side = Sidecar(
                home,
                { line -> toWebview(line) },
                { toWebview("{\"__vibe\":\"backend-error\"}") },
            )
            sidecar = side

            b.jbCefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
                override fun onLoadEnd(cef: CefBrowser?, frame: CefFrame?, httpStatusCode: Int) {
                    if (frame?.isMain != true) return
                    // Define the outbound function + announce the transport, so
                    // the bridge flushes any invokes it queued during boot.
                    val setup = "window.__vibeToJava = function(json) { ${query.inject("json")} };" +
                        "window.__vibeTransportReady && window.__vibeTransportReady();"
                    exec(setup)
                    pageReady = true
                    synchronized(pendingToJs) {
                        pendingToJs.forEach { exec("window.__vibeFromJava(${jsStringLiteral(it)})") }
                        pendingToJs.clear()
                    }
                    // Hand the project folder to the UI (opens straight into chat).
                    project.basePath?.let { cwd ->
                        val msg = "{\"__vibe\":\"cwd\",\"cwd\":${jsStringLiteral(cwd)}}"
                        exec("window.__vibeFromJava(${jsStringLiteral(msg)})")
                    }
                }
            }, b.cefBrowser)

            side.start()
            b.loadURL(HtmlBuilder.buildFileUrl(home))
            component = b.component
        }
    }

    private fun toWebview(line: String) {
        if (pageReady) exec("window.__vibeFromJava(${jsStringLiteral(line)})")
        else synchronized(pendingToJs) { pendingToJs.add(line) }
    }

    private fun exec(js: String) {
        val b = browser ?: return
        b.cefBrowser.executeJavaScript(js, b.cefBrowser.url ?: "", 0)
    }

    override fun dispose() {
        sidecar?.stop()
        jsQuery?.let { Disposer.dispose(it) }
    }
}
