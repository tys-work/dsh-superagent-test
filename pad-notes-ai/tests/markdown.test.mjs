import test from "node:test";
import assert from "node:assert/strict";

import { renderMarkdown } from "../js/markdown.js";

test("escapes raw HTML from model output", () => {
  const html = renderMarkdown('<script>alert("x")</script>');
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("never turns javascript: links into anchors", () => {
  const html = renderMarkdown("[click](javascript:alert(1))");
  assert.ok(!html.includes("href="));
  assert.ok(html.includes("click"));
});

test("renders headings, bold, italic, inline code and lists", () => {
  const html = renderMarkdown(
    "## 标题\n\n这是 **重点** 和 *强调*，还有 `code`。\n\n- 第一项\n- 第二项\n\n1. 甲\n2. 乙",
  );
  assert.ok(html.includes("<h2>标题</h2>"));
  assert.ok(html.includes("<strong>重点</strong>"));
  assert.ok(html.includes("<em>强调</em>"));
  assert.ok(html.includes("<code>code</code>"));
  assert.ok(html.includes("<ul><li>第一项</li><li>第二项</li></ul>"));
  assert.ok(html.includes("<ol><li>甲</li><li>乙</li></ol>"));
});

test("renders fenced code as escaped text and keeps http links", () => {
  const html = renderMarkdown('```html\n<img src=x onerror=alert(1)>\n```\n\n[文档](https://example.com)');
  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes('href="https://example.com"'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
});

test("keeps single newlines inside a paragraph", () => {
  const html = renderMarkdown("第一行\n第二行");
  assert.equal(html, "<p>第一行<br>第二行</p>");
});

test("handles empty and undefined input", () => {
  assert.equal(renderMarkdown(""), "");
  assert.equal(renderMarkdown(undefined), "");
});
