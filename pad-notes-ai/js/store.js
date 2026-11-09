/**
 * Local-first persistence. Everything lives in localStorage; there is no
 * backend and no account. Keys and notes never leave the browser except when
 * an AI request is explicitly sent to the configured endpoint.
 */

export const SETTINGS_KEY = "suimo.settings.v1";
export const DB_KEY = "suimo.notes.v1";
export const DB_VERSION = 1;

export const DEFAULT_SETTINGS = Object.freeze({
  theme: "system",
  paper: "dots",
  provider: "demo",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  apiKey: "",
  vision: true,
  autoSuggest: true,
  delay: 2500,
  cooldown: 30,
});

const SEED_TEXT = `今晚的阅读笔记 · 费曼学习法

把一个概念讲给完全不懂的人听。讲不清楚的地方，往往就是自己还没真懂的地方。

三个步骤
1. 选定一个概念，用最简单的语言写下来
2. 讲给一个外行听，卡住就回到资料里补
3. 用自己的话重新组织，直到不用术语也能讲通

我的疑问：遇到抽象概念时，怎么找到合适的类比？`;

function getStorage() {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    const probe = "__suimo_probe__";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

export function uid(prefix = "note") {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export function createNote(overrides = {}) {
  const now = Date.now();
  return {
    id: uid(),
    title: "未命名笔记",
    titleAuto: true,
    mode: "ink",
    text: "",
    strokes: [],
    chat: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function createSeedDB() {
  const note = createNote({
    title: "费曼学习法",
    titleAuto: false,
    mode: "text",
    text: SEED_TEXT,
  });
  return { version: DB_VERSION, activeId: note.id, notes: [note] };
}

/** Remove junk from a stored note, without throwing on partial data. */
export function normalizeNote(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.id !== "string") return null;
  const base = createNote();
  const strokes = Array.isArray(raw.strokes)
    ? raw.strokes
        .filter((stroke) => stroke && typeof stroke === "object" && Array.isArray(stroke.points))
        .map((stroke) => ({
          tool: stroke.tool === "highlighter" ? "highlighter" : "pen",
          color: typeof stroke.color === "string" ? stroke.color : "#2a2620",
          width: Number.isFinite(stroke.width) ? stroke.width : 3,
          points: stroke.points
            .filter((point) => Array.isArray(point) && point.length >= 2)
            .map((point) => [Number(point[0]) || 0, Number(point[1]) || 0, Number(point[2]) || 0.5]),
        }))
        .filter((stroke) => stroke.points.length > 0)
    : [];
  const chat = Array.isArray(raw.chat)
    ? raw.chat
        .filter((message) => message && typeof message === "object")
        .map((message) => ({
          role: message.role === "user" ? "user" : "assistant",
          content: typeof message.content === "string" ? message.content : "",
          at: Number.isFinite(message.at) ? message.at : Date.now(),
          ...(message.error ? { error: String(message.error) } : {}),
        }))
        .filter((message) => message.content || message.error)
        .slice(-40)
    : [];
  return {
    ...base,
    id: raw.id,
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.slice(0, 60) : "未命名笔记",
    titleAuto: raw.titleAuto === true,
    mode: raw.mode === "text" ? "text" : "ink",
    text: typeof raw.text === "string" ? raw.text : "",
    strokes,
    chat,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : base.createdAt,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : base.updatedAt,
  };
}

export function normalizeDB(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.notes)) return null;
  const notes = raw.notes.map(normalizeNote).filter(Boolean);
  if (!notes.length) return null;
  const activeId = notes.some((note) => note.id === raw.activeId) ? raw.activeId : notes[0].id;
  return { version: DB_VERSION, activeId, notes };
}

export function loadDB(storage = getStorage()) {
  if (!storage) return createSeedDB();
  try {
    const raw = storage.getItem(DB_KEY);
    if (!raw) return createSeedDB();
    const parsed = normalizeDB(JSON.parse(raw));
    return parsed ?? createSeedDB();
  } catch {
    return createSeedDB();
  }
}

export function saveDB(db, storage = getStorage()) {
  if (!storage) return false;
  try {
    storage.setItem(DB_KEY, JSON.stringify(db));
    return true;
  } catch {
    return false;
  }
}

export function loadSettings(storage = getStorage()) {
  if (!storage) return { ...DEFAULT_SETTINGS };
  try {
    const raw = storage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return normalizeSettings(parsed);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function normalizeSettings(raw) {
  const merged = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === "object" ? raw : {}) };
  return {
    theme: ["light", "dark", "system"].includes(merged.theme) ? merged.theme : DEFAULT_SETTINGS.theme,
    paper: ["dots", "lines", "blank"].includes(merged.paper) ? merged.paper : DEFAULT_SETTINGS.paper,
    provider: typeof merged.provider === "string" ? merged.provider : DEFAULT_SETTINGS.provider,
    baseUrl: typeof merged.baseUrl === "string" ? merged.baseUrl : DEFAULT_SETTINGS.baseUrl,
    model: typeof merged.model === "string" ? merged.model : DEFAULT_SETTINGS.model,
    apiKey: typeof merged.apiKey === "string" ? merged.apiKey : "",
    vision: Boolean(merged.vision),
    autoSuggest: Boolean(merged.autoSuggest),
    delay: [1500, 2500, 4000, 7000].includes(Number(merged.delay)) ? Number(merged.delay) : 2500,
    cooldown: [15, 30, 60].includes(Number(merged.cooldown)) ? Number(merged.cooldown) : 30,
  };
}

export function saveSettings(settings, storage = getStorage()) {
  if (!storage) return false;
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

export function clearAll(storage = getStorage()) {
  if (!storage) return;
  try {
    storage.removeItem(DB_KEY);
    storage.removeItem(SETTINGS_KEY);
  } catch {
    /* ignore */
  }
}

/** Build a sensible title from the first line of a text note. */
export function deriveTitle(text) {
  const line = String(text || "")
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  if (!line) return "未命名笔记";
  return line.replace(/^#+\s*/, "").replace(/^[·•\-\d.、)\s]+/, "").slice(0, 32) || "未命名笔记";
}

export function noteExcerpt(note) {
  if (!note) return "";
  if (note.mode === "ink" && note.strokes.length) {
    const points = note.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0);
    return `手写 · ${note.strokes.length} 笔`;
  }
  if (note.text.trim()) {
    const lines = note.text
      .split("\n")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    const line = lines.find((part) => part !== note.title) || lines[0] || "";
    return line ? line.slice(0, 70) : "";
  }
  return "空白笔记";
}

export function noteStats(note) {
  if (!note) return "0 字";
  if (note.mode === "ink") {
    return note.strokes.length ? `${note.strokes.length} 笔` : "空白画布";
  }
  const count = (note.text.match(/[\u4e00-\u9fff]|[A-Za-z0-9]+/g) || []).length;
  return `${count} 字`;
}
