package com.vibeshell

import java.io.BufferedWriter
import java.io.File

/**
 * Runs the Node backend sidecar and pipes it over stdio. Each stdout line is
 * a {__vibe:...} JSON message forwarded to [onLine]; [send] writes a JSON
 * invoke line to the sidecar's stdin. [onError] fires if the sidecar can't
 * start (e.g. Node.js not installed) or exits unexpectedly, so the panel can
 * tell the user instead of hanging.
 */
class Sidecar(
    private val home: File,
    private val onLine: (String) -> Unit,
    private val onError: () -> Unit,
) {
    @Volatile private var process: Process? = null
    @Volatile private var writer: BufferedWriter? = null
    @Volatile private var stopped = false

    fun start() {
        val sidecar = AppHome.sidecarJs(home)
        val pb = ProcessBuilder(resolveNode(), sidecar.absolutePath)
        pb.directory(home)
        pb.redirectErrorStream(false)

        val p = try {
            pb.start()
        } catch (_: Exception) {
            onError() // Node.js not on PATH, etc.
            return
        }
        process = p
        writer = p.outputStream.bufferedWriter()

        Thread({
            try {
                p.inputStream.bufferedReader().forEachLine { line ->
                    if (line.isNotBlank()) onLine(line)
                }
            } catch (_: Exception) { /* pipe closed */ }
            // The reader ending means the process exited. If we didn't ask it
            // to stop, the backend died — surface it.
            if (!stopped) onError()
        }, "vibeshell-sidecar-out").apply { isDaemon = true }.start()

        Thread({
            try { p.errorStream.bufferedReader().forEachLine { /* diagnostics */ } }
            catch (_: Exception) {}
        }, "vibeshell-sidecar-err").apply { isDaemon = true }.start()
    }

    fun send(json: String) {
        val w = writer ?: return
        try {
            synchronized(w) { w.write(json); w.write("\n"); w.flush() }
        } catch (_: Exception) { /* sidecar gone */ }
    }

    fun stop() {
        stopped = true
        try { writer?.close() } catch (_: Exception) {}
        process?.destroy()
        process = null
        writer = null
    }

    private fun resolveNode(): String =
        if (System.getProperty("os.name").startsWith("Windows")) "node.exe" else "node"
}
