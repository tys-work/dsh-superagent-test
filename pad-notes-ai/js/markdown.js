/**
 * A deliberately small Markdown renderer for AI replies.
 *
 * Everything is HTML-escaped first, then a safe subset of Markdown is turned
 * into markup. Raw HTML and non-http(s) links never pass through.
 */

import { escapeHtml } from "./util.js";

const BLOCK_START =
  /^(?:\s*```|\s*#{1,4}\s|\s*>|\s*[-*+]\s+|\s*\d+[.)]\s+|\s*(?:---+|\*\*\*+|___+)\s*$)/;

function renderInline(raw) {
  const stash = [];
  let text = escapeHtml(raw).replace(/`([^`\n]+)`/g, (_, code) => {
    stash.push(`<code>${code}</code>`);
    return `\u0000${stash.length - 1}\u0000`;
  });

  text = text.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`,
  );
  text = text.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  text = text.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
  text = text.replace(/\u0000(\d+)\u0000/g, (_, index) => stash[Number(index)]);
  return text;
}

function parseList(lines, start, ordered) {
  const items = [];
  const pattern = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
  let index = start;
  while (index < lines.length) {
    const match = lines[index].match(pattern);
    if (!match) {
      // Allow a blank line inside a loose list, but stop at the next block.
      if (!lines[index].trim() && index + 1 < lines.length && pattern.test(lines[index + 1])) {
        index += 1;
        continue;
      }
      break;
    }
    items.push(match[1]);
    index += 1;
  }
  return { items, next: index };
}

export function renderMarkdown(source) {
  const lines = String(source ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");
  const html = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (/^\s*```/.test(line)) {
      const language = line.replace(/^\s*```/, "").trim().slice(0, 24).replace(/[^\w+-]/g, "");
      const code = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      html.push(
        `<pre><code${language ? ` class="language-${language}"` : ""}>${escapeHtml(code.join("\n"))}</code></pre>`,
      );
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
      html.push("<hr>");
      i += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoted = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoted.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      html.push(`<blockquote>${renderInline(quoted.join(" "))}</blockquote>`);
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const { items, next } = parseList(lines, i, false);
      i = next;
      html.push(`<ul>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const { items, next } = parseList(lines, i, true);
      i = next;
      html.push(`<ol>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ol>`);
      continue;
    }

    const paragraph = [];
    while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i])) {
      paragraph.push(lines[i]);
      i += 1;
    }
    if (!paragraph.length) {
      // Safety valve: never spin forever on a line we did not classify.
      html.push(`<p>${renderInline(line)}</p>`);
      i += 1;
      continue;
    }
    html.push(`<p>${paragraph.map((part) => renderInline(part)).join("<br>")}</p>`);
  }

  return html.join("\n");
}
