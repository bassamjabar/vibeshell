package com.vibeshell

import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory

/** Registers the VibeShell panel in the bottom tool-window strip (next to
 *  the Terminal). */
class VibeShellToolWindowFactory : ToolWindowFactory, DumbAware {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = VibeShellPanel(project)
        val content = ContentFactory.getInstance().createContent(panel.component, "", false)
        Disposer.register(content, panel)
        toolWindow.contentManager.addContent(content)
    }
}
