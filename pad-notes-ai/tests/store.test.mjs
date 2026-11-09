import test from "node:test";
import assert from "node:assert/strict";

import {
  DB_KEY,
  SETTINGS_KEY,
  createNote,
  createSeedDB,
  deriveTitle,
  loadDB,
  loadSettings,
  normalizeNote,
  normalizeSettings,
  noteExcerpt,
  noteStats,
  saveDB,
  saveSettings,
} from "../js/store.js";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

test("seeded database has one readable note", () => {
  const db = createSeedDB();
  assert.equal(db.notes.length, 1);
  assert.equal(db.notes[0].mode, "text");
  assert.match(db.notes[0].text, /费曼/);
  assert.equal(db.activeId, db.notes[0].id);
});

test("save and load round-trip notes through storage", () => {
  const storage = memoryStorage();
  const db = createSeedDB();
  db.notes.push(createNote({ mode: "ink", title: "手写页" }));
  assert.equal(saveDB(db, storage), true);
  const loaded = loadDB(storage);
  assert.equal(loaded.notes.length, 2);
  assert.equal(loaded.notes[1].title, "手写页");
});

test("missing or corrupt storage falls back to a seed note", () => {
  const storage = memoryStorage();
  assert.equal(loadDB(storage).notes.length, 1);
  storage.setItem(DB_KEY, "{not json");
  assert.equal(loadDB(storage).notes.length, 1);
});

test("normalizeNote drops invalid strokes and clamps chat", () => {
  const note = normalizeNote({
    id: "n1",
    title: "  ",
    mode: "text",
    text: "hello",
    strokes: [
      { tool: "pen", color: "#000", width: 3, points: [[1, 2, 0.5]] },
      { tool: "pen", points: [] },
      "bad",
    ],
    chat: Array.from({ length: 60 }, (_, index) => ({ role: "user", content: `m${index}`, at: index })),
  });
  assert.equal(note.title, "未命名笔记");
  assert.equal(note.strokes.length, 1);
  assert.equal(note.chat.length, 40);
  assert.equal(note.chat.at(-1).content, "m59");
});

test("settings are validated and merged with defaults", () => {
  assert.equal(loadSettings(memoryStorage()).provider, "demo");
  const storage = memoryStorage();
  saveSettings({ provider: "openai", theme: "neon", delay: 1, cooldown: 999 }, storage);
  const loaded = loadSettings(storage);
  assert.equal(loaded.provider, "openai");
  assert.equal(loaded.theme, "system");
  assert.equal(loaded.delay, 2500);
  assert.equal(loaded.cooldown, 30);
  assert.equal(loaded.autoSuggest, true);
});

test("normalizeSettings keeps known values", () => {
  const settings = normalizeSettings({
    theme: "dark",
    paper: "lines",
    delay: 4000,
    cooldown: 60,
    autoSuggest: false,
  });
  assert.equal(settings.theme, "dark");
  assert.equal(settings.paper, "lines");
  assert.equal(settings.delay, 4000);
  assert.equal(settings.cooldown, 60);
  assert.equal(settings.autoSuggest, false);
});

test("title, excerpt and stats helpers", () => {
  assert.equal(deriveTitle("\n\n## 我的标题\n正文"), "我的标题");
  assert.equal(deriveTitle("   "), "未命名笔记");

  const note = createNote({ mode: "text", text: "第一行\n第二行" });
  assert.equal(noteExcerpt(note), "第一行");
  assert.equal(noteStats(note), "6 字");

  const ink = createNote({
    mode: "ink",
    strokes: [
      { tool: "pen", color: "#000", width: 3, points: [[1, 1, 0.5]] },
      { tool: "pen", color: "#000", width: 3, points: [[2, 2, 0.5]] },
    ],
  });
  assert.equal(noteStats(ink), "2 笔");
  assert.equal(noteExcerpt(ink), "手写 · 2 笔");
});

test("storage keys stay stable", () => {
  assert.equal(DB_KEY, "suimo.notes.v1");
  assert.equal(SETTINGS_KEY, "suimo.settings.v1");
});
