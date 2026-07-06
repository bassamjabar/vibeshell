package com.vibeshell

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.startup.ProjectActivity
import com.intellij.openapi.wm.ToolWindowManager
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Lets the `vibeshell` terminal command open the panel inside this IDE.
 *
 * JetBrains IDEs have no simple URI handler like VS Code's `code --open-url`,
 * so the CLI drops the terminal's folder into ~/.vibeshell/ide-open and this
 * watcher (one daemon poller per IDE) picks it up and activates the VibeShell
 * tool window on the project that owns that folder.
 */
class VibeShellTerminalWatcher : ProjectActivity {
    override suspend fun execute(project: Project) {
        ensurePoller()
    }

    companion object {
        private val started = AtomicBoolean(false)

        private fun ensurePoller() {
            if (!started.compareAndSet(false, true)) return
            val trigger = File(System.getProperty("user.home"), ".vibeshell/ide-open")

            Thread({
                while (true) {
                    try {
                        if (trigger.exists()) {
                            val cwd = trigger.readText().trim()
                            if (openForCwd(cwd)) trigger.delete()
                        }
                    } catch (_: Exception) { /* keep polling */ }
                    try { Thread.sleep(700) } catch (_: InterruptedException) { break }
                }
            }, "vibeshell-terminal-watcher").apply { isDaemon = true }.start()
        }

        private fun norm(p: String) = p.replace('\\', '/').trimEnd('/').lowercase()

        // Activate the tool window on the project containing cwd (or, if none
        // matches — e.g. a different IDE owns it — leave the trigger for them).
        // Returns true if this IDE handled it.
        private fun openForCwd(cwd: String): Boolean {
            val projects = ProjectManager.getInstance().openProjects
            if (projects.isEmpty()) return false
            val target = norm(cwd)
            val match = projects.firstOrNull { p ->
                val base = p.basePath?.let { norm(it) } ?: return@firstOrNull false
                target == base || target.startsWith("$base/")
            } ?: return false // not ours — another IDE may own this folder

            ApplicationManager.getApplication().invokeLater {
                ToolWindowManager.getInstance(match).getToolWindow("VibeShell")?.activate(null)
            }
            return true
        }
    }
}
