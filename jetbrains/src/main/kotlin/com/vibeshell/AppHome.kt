package com.vibeshell

import java.io.File

/**
 * Locates the VibeShell app files (index.html, renderer/, main/, node_modules,
 * the sidecar, and the shared webview bridge). Override with the VIBESHELL_HOME
 * environment variable; otherwise falls back to the repo on this machine.
 */
object AppHome {
    fun resolve(): File {
        System.getenv("VIBESHELL_HOME")?.let {
            val dir = File(it)
            if (File(dir, "index.html").exists()) return dir
        }
        val default = File(System.getProperty("user.home"), "Desktop/AIShell")
        return default
    }

    fun indexHtml(home: File) = File(home, "index.html")
    fun bridgeJs(home: File) = File(home, "vscode-extension/media/bridge.js")
    fun sidecarJs(home: File) = File(home, "jetbrains/sidecar/sidecar.js")
}
