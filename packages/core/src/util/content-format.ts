/**
 * Turns editor text into safe HTML. Everything is escaped first, then a small set of markers is recognised:
 *   `## Heading`, `### Sub-heading`, `- list item`, blank line between paragraphs,
 *   `**bold**`, `[text](link)` where the link is `/path`, `https://...` or `mailto:...`.
 * Nothing else can produce markup, so scripts, event handlers and `javascript:` links are impossible.
 */
const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const SAFE_LINK = /^(\/(?!\/)[^\s]*|https:\/\/[^\s]+|http:\/\/[^\s]+|mailto:[^\s]+)$/i;

function inline(escaped: string): string {
  return escaped
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, url: string) => {
      // Undo the escaping applied to the URL so `&` in query strings still works, then re-escape for the attribute.
      const raw = url.replace(/&amp;/g, '&');
      return SAFE_LINK.test(raw) ? `<a href="${escapeHtml(raw)}"${/^https?:/i.test(raw) ? ' rel="noopener noreferrer"' : ''}>${text}</a>` : text;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

export function renderContent(source: string): string {
  const blocks = source.replace(/\r\n/g, '\n').split(/\n{2,}/);
  const html: string[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim().length > 0);
    if (lines.length === 0) continue;
    if (lines.every((l) => /^\s*-\s+/.test(l))) {
      html.push(`<ul>${lines.map((l) => `<li>${inline(escapeHtml(l.replace(/^\s*-\s+/, '')))}</li>`).join('')}</ul>`);
      continue;
    }
    const first = lines[0];
    const heading = /^(#{2,3})\s+(.*)$/.exec(first);
    if (heading && lines.length === 1) {
      const level = heading[1].length;
      html.push(`<h${level}>${inline(escapeHtml(heading[2]))}</h${level}>`);
      continue;
    }
    html.push(`<p>${lines.map((l) => inline(escapeHtml(l))).join('<br>')}</p>`);
  }
  return html.join('');
}

/** Best-effort reverse for pages that only have HTML (seeded content), so the editor has text to start from. */
export function htmlToSource(html: string): string {
  return html
    .replace(/<h2>(.*?)<\/h2>/g, '## $1\n\n')
    .replace(/<h3>(.*?)<\/h3>/g, '### $1\n\n')
    .replace(/<li>(.*?)<\/li>/g, '- $1\n')
    .replace(/<\/ul>/g, '\n')
    .replace(/<\/p>\s*/g, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}
