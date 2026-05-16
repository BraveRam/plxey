import { marked, type Token, type Tokens } from "marked";

// Telegram's HTML parse_mode only escapes &, <, > in body text.
// Quotes only need escaping inside attribute values (see escapeAttr).
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

// Only let through hrefs whose protocol is safe to embed in <a href>.
// Anything else (javascript:, data:, file:, etc.) drops back to text-only.
function safeHref(href: string): string | null {
  if (!/^(https?:\/\/|tg:\/\/|mailto:)/i.test(href)) return null;
  return escapeAttr(href);
}

function sanitizeLang(lang: string | undefined): string {
  return (lang ?? "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 30);
}

function renderInline(tokens: Token[]): string {
  let out = "";
  for (const tok of tokens) {
    switch (tok.type) {
      case "text": {
        const t = tok as Tokens.Text;
        if (t.tokens && t.tokens.length > 0) {
          out += renderInline(t.tokens);
        } else {
          out += escapeHtml(t.text);
        }
        break;
      }
      case "strong":
        out += `<b>${renderInline((tok as Tokens.Strong).tokens)}</b>`;
        break;
      case "em":
        out += `<i>${renderInline((tok as Tokens.Em).tokens)}</i>`;
        break;
      case "del":
        out += `<s>${renderInline((tok as Tokens.Del).tokens)}</s>`;
        break;
      case "codespan":
        out += `<code>${escapeHtml((tok as Tokens.Codespan).text)}</code>`;
        break;
      case "link": {
        const link = tok as Tokens.Link;
        const href = safeHref(link.href);
        const inner = renderInline(link.tokens);
        out += href ? `<a href="${href}">${inner}</a>` : inner;
        break;
      }
      case "image": {
        // Telegram won't inline images in a text message. Fall back to alt text.
        const img = tok as Tokens.Image;
        out += escapeHtml(img.text ?? "");
        break;
      }
      case "br":
        out += "\n";
        break;
      case "escape":
        out += escapeHtml((tok as Tokens.Escape).text);
        break;
      case "html":
        // Raw HTML in the source — escape so it renders as literal text,
        // never executes/structures Telegram's parser.
        out += escapeHtml((tok as Tokens.HTML).text);
        break;
      default: {
        const fallback = (tok as { text?: string }).text;
        if (typeof fallback === "string") out += escapeHtml(fallback);
        break;
      }
    }
  }
  return out;
}

function renderBlock(tok: Token): string {
  switch (tok.type) {
    case "heading":
      // Telegram has no <h1>-<h6>. Bold them so they still stand out.
      return `<b>${renderInline((tok as Tokens.Heading).tokens)}</b>\n\n`;
    case "paragraph":
      return `${renderInline((tok as Tokens.Paragraph).tokens)}\n\n`;
    case "code": {
      const c = tok as Tokens.Code;
      const body = escapeHtml(c.text);
      const lang = sanitizeLang(c.lang);
      return lang
        ? `<pre><code class="language-${lang}">${body}</code></pre>\n\n`
        : `<pre>${body}</pre>\n\n`;
    }
    case "blockquote": {
      const inner = renderTokens((tok as Tokens.Blockquote).tokens).trim();
      return `<blockquote>${inner}</blockquote>\n\n`;
    }
    case "hr":
      return "———\n\n";
    case "list": {
      const list = tok as Tokens.List;
      const start = typeof list.start === "number" ? list.start : 1;
      let out = "";
      for (let i = 0; i < list.items.length; i++) {
        const item = list.items[i]!;
        const marker = list.ordered ? `${start + i}.` : "•";
        const inner = renderTokens(item.tokens).replace(/\n+$/, "").trim();
        out += `${marker} ${inner}\n`;
      }
      return out + "\n";
    }
    case "table": {
      // Telegram has no tables. Flatten to pipe-separated rows so the data
      // is still legible.
      const table = tok as Tokens.Table;
      const headerLine = table.header
        .map((cell) => renderInline(cell.tokens).trim())
        .join(" | ");
      const rows = table.rows.map((row) =>
        row.map((cell) => renderInline(cell.tokens).trim()).join(" | "),
      );
      return [headerLine, ...rows].join("\n") + "\n\n";
    }
    case "space":
      return "";
    case "html":
      return escapeHtml((tok as Tokens.HTML).text);
    default:
      // Fall back to inline rendering for anything unrecognized at top level.
      return renderInline([tok]);
  }
}

function renderTokens(tokens: Token[]): string {
  let out = "";
  for (const tok of tokens) {
    out += renderBlock(tok);
  }
  return out;
}

export function markdownToTelegramHtml(md: string): string {
  if (!md) return "";
  const tokens = marked.lexer(md, { gfm: true, breaks: false });
  return renderTokens(tokens).replace(/\n{3,}/g, "\n\n").trim();
}
