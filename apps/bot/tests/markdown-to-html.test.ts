import { describe, expect, test } from "bun:test";
import {
  escapeHtml,
  markdownToTelegramHtml,
} from "../src/lib/markdown-to-html";

describe("escapeHtml", () => {
  test("escapes &, <, > but leaves quotes alone for body text", () => {
    expect(escapeHtml("a & b <c> \"d\"")).toBe("a &amp; b &lt;c&gt; \"d\"");
  });

  test("escapes ampersand before angle brackets so it doesn't double-encode", () => {
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });
});

describe("markdownToTelegramHtml", () => {
  test("plain text passes through with HTML chars escaped", () => {
    expect(markdownToTelegramHtml("hello world")).toBe("hello world");
    expect(markdownToTelegramHtml("a < b & c > d")).toBe("a &lt; b &amp; c &gt; d");
  });

  test("renders bold via <b>", () => {
    expect(markdownToTelegramHtml("**hi**")).toBe("<b>hi</b>");
  });

  test("renders italic via <i>", () => {
    expect(markdownToTelegramHtml("*hi*")).toBe("<i>hi</i>");
    expect(markdownToTelegramHtml("_hi_")).toBe("<i>hi</i>");
  });

  test("renders GFM strikethrough via <s>", () => {
    expect(markdownToTelegramHtml("~~gone~~")).toBe("<s>gone</s>");
  });

  test("inline code becomes <code> with content escaped", () => {
    expect(markdownToTelegramHtml("use `a < b`")).toBe(
      "use <code>a &lt; b</code>",
    );
  });

  test("fenced code with language hint becomes <pre><code class=\"language-…\">", () => {
    const out = markdownToTelegramHtml("```bash\nnpm run dev\n```");
    expect(out).toBe('<pre><code class="language-bash">npm run dev</code></pre>');
  });

  test("fenced code without language becomes plain <pre>", () => {
    const out = markdownToTelegramHtml("```\nplain\n```");
    expect(out).toBe("<pre>plain</pre>");
  });

  test("language hint is sanitized to alphanumerics/dash so it can't break the class attribute", () => {
    const out = markdownToTelegramHtml("```bash --verbose\nx\n```");
    expect(out).toBe('<pre><code class="language-bash--verbose">x</code></pre>');
  });

  test("code body has < > & escaped so the parser doesn't choke", () => {
    const out = markdownToTelegramHtml("```\nif (a < b && c > d) {}\n```");
    expect(out).toBe("<pre>if (a &lt; b &amp;&amp; c &gt; d) {}</pre>");
  });

  test("headings degrade to bold + newline (Telegram has no heading support)", () => {
    expect(markdownToTelegramHtml("# Title")).toBe("<b>Title</b>");
    expect(markdownToTelegramHtml("### Getting Started")).toBe(
      "<b>Getting Started</b>",
    );
  });

  test("unordered list becomes bullet lines", () => {
    expect(markdownToTelegramHtml("- one\n- two")).toBe("• one\n• two");
  });

  test("ordered list preserves numbering and start index", () => {
    expect(markdownToTelegramHtml("1. one\n2. two")).toBe("1. one\n2. two");
    expect(markdownToTelegramHtml("3. three\n4. four")).toBe("3. three\n4. four");
  });

  test("blockquote becomes <blockquote>", () => {
    expect(markdownToTelegramHtml("> quoted")).toBe(
      "<blockquote>quoted</blockquote>",
    );
  });

  test("link becomes <a href> with text rendered, special chars in href encoded", () => {
    expect(markdownToTelegramHtml("[grammy](https://grammy.dev)")).toBe(
      '<a href="https://grammy.dev">grammy</a>',
    );
    expect(
      markdownToTelegramHtml('[search](https://x.com/?q=a&b=1)'),
    ).toBe('<a href="https://x.com/?q=a&amp;b=1">search</a>');
  });

  test("link with unsafe protocol is rendered as text only — no href", () => {
    expect(markdownToTelegramHtml("[click](javascript:alert(1))")).toBe(
      "click",
    );
  });

  test("image falls back to alt text since Telegram won't render inline images", () => {
    expect(
      markdownToTelegramHtml("![diagram](https://e.com/d.png)"),
    ).toBe("diagram");
  });

  test("raw inline HTML in the source is escaped — no script injection", () => {
    expect(markdownToTelegramHtml("hi <script>x()</script>")).toBe(
      "hi &lt;script&gt;x()&lt;/script&gt;",
    );
  });

  test("multiple paragraphs separated by blank line keep one blank line between them", () => {
    expect(markdownToTelegramHtml("first\n\nsecond")).toBe("first\n\nsecond");
  });

  test("mixed real-world LLM output reproduces the bug-fix scenario", () => {
    const input = [
      "Here's some information about Next.js! 🚀",
      "",
      "### Getting Started",
      "",
      "You can bootstrap a Next.js project using:",
      "",
      "```bash",
      "npx create-next-app@latest",
      "```",
    ].join("\n");

    const out = markdownToTelegramHtml(input);

    expect(out).toContain("Here's some information about Next.js! 🚀");
    expect(out).toContain("<b>Getting Started</b>");
    expect(out).toContain(
      '<pre><code class="language-bash">npx create-next-app@latest</code></pre>',
    );
    expect(out).not.toContain("###");
    expect(out).not.toContain("```");
  });

  test("empty input returns empty string", () => {
    expect(markdownToTelegramHtml("")).toBe("");
  });
});
