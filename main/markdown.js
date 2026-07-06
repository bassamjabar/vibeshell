// Markdown → safe HTML, rendered in the MAIN process.
// The renderer stays dependency-free: it receives ready-to-insert HTML.
// Raw HTML inside the markdown is escaped (never executed), and code
// blocks are syntax-highlighted with highlight.js.

const { marked } = require('marked');
const hljs = require('highlight.js');

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    // Fenced code blocks → highlighted block with a copy button header.
    code({ text, lang }) {
      const language = lang && hljs.getLanguage(lang) ? lang : null;
      const body = language
        ? hljs.highlight(text, { language }).value
        : escapeHtml(text);
      return (
        `<div class="code-block">` +
        `<div class="code-head"><span>${escapeHtml(language || 'code')}</span>` +
        `<button class="copy-btn" type="button">Copy</button></div>` +
        `<pre><code class="hljs">${body}</code></pre>` +
        `</div>`
      );
    },
    // Never let raw HTML from the model reach the DOM as markup.
    html({ text }) {
      return escapeHtml(text);
    },
  },
});

function renderMarkdown(markdown) {
  return marked.parse(String(markdown || ''));
}

module.exports = { renderMarkdown, escapeHtml };
