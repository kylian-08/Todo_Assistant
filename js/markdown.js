/** Lightweight Markdown → HTML (offline, no deps) */
function renderMarkdown(src) {
  if (!src) return '';
  let html = escMd(src);

  html = html.replace(/```([\s\S]*?)```/g, (_, code) =>
    `<pre class="md-pre"><code>${code.trim()}</code></pre>`);
  html = html.replace(/`([^`]+)`/g, '<code class="md-code">$1</code>');
  html = html.replace(/^#### (.+)$/gm, '<h4 class="md-h4">$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3 class="md-h3">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="md-h2">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="md-h1">$1</h1>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  html = html.replace(/^[-*] (.+)$/gm, '<li class="md-li">$1</li>');
  html = html.replace(/(<li class="md-li">.*<\/li>\n?)+/g, m => `<ul class="md-ul">${m}</ul>`);
  html = html.replace(/^\d+\. (.+)$/gm, '<li class="md-oli">$1</li>');
  html = html.replace(/(<li class="md-oli">.*<\/li>\n?)+/g, m => `<ol class="md-ol">${m}</ol>`);
  html = html.replace(/\n\n/g, '</p><p class="md-p">');
  html = `<p class="md-p">${html}</p>`;
  html = html.replace(/<p class="md-p"><\/p>/g, '');
  html = html.replace(/<p class="md-p">(<h[1-4]|<ul|<ol|<pre)/g, '$1');
  html = html.replace(/(<\/h[1-4]>|<\/ul>|<\/ol>|<\/pre>)<\/p>/g, '$1');
  return html;
}

function escMd(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
