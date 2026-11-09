import test from "node:test";
import assert from "node:assert/strict";

import {
  PROVIDERS,
  analyzeNote,
  buildChatMessages,
  buildDemoAnswer,
  buildSuggestionMessages,
  demoAnalysis,
  extractJson,
  isConfigured,
  noteSignature,
  normalizeSuggestions,
} from "../js/ai.js";
import { createNote } from "../js/store.js";

test("extractJson tolerates fenced JSON and surrounding prose", () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('好的，这是结果：{"a":1} 希望有用'), { a: 1 });
  assert.equal(extractJson("不是 JSON"), null);
  assert.equal(extractJson(""), null);
});

test("normalizeSuggestions clamps fields and types", () => {
  const result = normalizeSuggestions({
    reading: "一段概括",
    suggestions: [
      { type: "nope", title: "  标题  ", body: "正文" },
      { type: "check", title: "第二个", body: "内容" },
      { type: "extend", title: "第三个", body: "内容" },
      { type: "insight", title: "第四个会被截掉", body: "内容" },
    ],
  });
  assert.equal(result.suggestions.length, 3);
  assert.equal(result.suggestions[0].type, "insight");
  assert.equal(result.suggestions[0].title, "标题");
  assert.equal(result.reading, "一段概括");
});

test("buildSuggestionMessages attaches the page image for ink notes", () => {
  const note = createNote({ mode: "ink", strokes: [{ tool: "pen", color: "#000", width: 3, points: [[1, 2, 0.5]] }] });
  const messages = buildSuggestionMessages({ note, imageDataUrl: "data:image/jpeg;base64,abc" });
  assert.equal(messages[0].role, "system");
  assert.ok(Array.isArray(messages[1].content));
  assert.equal(messages[1].content[1].type, "image_url");
  assert.match(messages[1].content[1].image_url.url, /^data:image\/jpeg/);
});

test("buildChatMessages includes note text and history", () => {
  const note = createNote({ mode: "text", text: "费曼学习法：讲给别人听。" });
  const messages = buildChatMessages({
    note,
    history: [
      { role: "user", content: "你好", at: 1 },
      { role: "assistant", content: "你好！", at: 2 },
      { role: "assistant", content: "错误", error: "失败" },
    ],
    question: "总结一下",
  });
  assert.equal(messages[0].role, "system");
  assert.ok(messages[0].content.includes("费曼学习法"));
  assert.ok(messages.some((message) => message.content === "你好"));
  assert.ok(!messages.some((message) => message.error));
  assert.equal(messages.at(-1).content, "总结一下");
});

test("demoAnalysis produces suggestions for text and ink notes", () => {
  const textNote = createNote({ mode: "text", text: "费曼学习法。把概念讲给外行听。我的疑问：如何找类比？" });
  const textResult = demoAnalysis(textNote);
  assert.ok(textResult.suggestions.length >= 1);
  assert.ok(textResult.reading.includes("费曼"));

  const inkNote = createNote({ mode: "ink", strokes: [{ tool: "pen", color: "#000", width: 3, points: [[1, 1, 0.5]] }] });
  const inkResult = demoAnalysis(inkNote);
  assert.ok(inkResult.suggestions.length >= 1);
  assert.match(inkResult.reading, /演示模式/);
});

test("demo answer follows the question and mentions demo mode", () => {
  const note = createNote({ mode: "text", text: "第一句。第二句。第三句。" });
  const summary = buildDemoAnswer("帮我总结这页", note);
  assert.match(summary, /总结|这页笔记/);
  assert.match(summary, /本地演示/);
  const quiz = buildDemoAnswer("出三道题", note);
  assert.match(quiz, /自测|题/);
});

test("configuration detection respects demo mode and required fields", () => {
  assert.equal(isConfigured({ provider: "demo" }), true);
  assert.equal(
    isConfigured({ provider: "openai", baseUrl: "https://x/v1", model: "m", apiKey: "" }),
    false,
  );
  assert.equal(
    isConfigured({ provider: "openai", baseUrl: "https://x/v1", model: "m", apiKey: "k" }),
    true,
  );
  assert.ok(PROVIDERS.deepseek);
});

test("noteSignature changes when note content changes", () => {
  const note = createNote({ mode: "text", text: "abc" });
  const first = noteSignature(note);
  note.text = "abcd";
  assert.notEqual(noteSignature(note), first);
});

test("analyzeNote is exported and rejects without configuration", async () => {
  const note = createNote({ mode: "text", text: "内容" });
  await assert.rejects(
    analyzeNote({ settings: { provider: "demo" }, note }),
    /演示模式/,
  );
});
