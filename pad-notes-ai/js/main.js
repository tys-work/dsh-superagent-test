/**
 * 随墨 Suimo — application controller.
 *
 * The app is local-first: notes live in localStorage, AI requests go straight
 * from the browser to the endpoint configured in Settings.
 */

import {
  PROVIDERS,
  SUGGESTION_TYPES,
  analyzeNote,
  demoAnalyzeStream,
  demoChatStream,
  isConfigured,
  isDemo,
  noteSignature,
  providerLabel,
  streamAnswer,
  testConnection,
} from "./ai.js";
import { InkEngine } from "./ink.js";
import { renderMarkdown } from "./markdown.js";
import {
  clearAll,
  createNote,
  deriveTitle,
  loadDB,
  loadSettings,
  noteExcerpt,
  noteStats,
  normalizeSettings,
  saveDB,
  saveSettings,
} from "./store.js";
import {
  autoGrow,
  copyText,
  debounce,
  downloadBlob,
  formatClock,
  formatRelative,
  rafThrottle,
  safeFilename,
  truncate,
} from "./util.js";

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const PEN_COLORS = [
  { name: "墨黑", value: "#26221c" },
  { name: "朱砂", value: "#b9481f" },
  { name: "靛蓝", value: "#2f5d8a" },
  { name: "松绿", value: "#3d7a5c" },
  { name: "紫藤", value: "#6d4b8a" },
];

const HIGHLIGHTER_COLORS = [
  { name: "琥珀", value: "#f0c04c" },
  { name: "樱粉", value: "#ee9cb6" },
  { name: "嫩绿", value: "#9ccf9f" },
  { name: "天蓝", value: "#91c3ef" },
];

const WIDTHS = [2.4, 3.6, 5.2];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

/* ------------------------------------------------------------------ */
/* Elements                                                            */
/* ------------------------------------------------------------------ */

const els = {
  app: $("#app"),
  sidebar: $("#sidebar"),
  scrim: $("#scrim"),
  sidebarToggle: $("#sidebarToggle"),
  aiDrawerBtn: $("#aiDrawerBtn"),
  aiRailClose: $("#aiRailClose"),
  brand: $(".brand"),
  noteTitle: $("#noteTitle"),
  saveState: $("#saveState"),
  noteStatsTop: $("#noteStats"),
  themeBtn: $("#themeBtn"),
  settingsBtn: $("#settingsBtn"),
  aiToggle: $("#aiToggle"),
  aiPillLabel: $(".ai-pill-label"),

  newNoteBtn: $("#newNoteBtn"),
  searchInput: $("#searchInput"),
  noteList: $("#noteList"),
  noteCount: $("#noteCount"),
  apiCard: $("#apiCard"),
  apiDot: $("#apiDot"),
  apiLabel: $("#apiLabel"),
  apiSub: $("#apiSub"),

  modeButtons: $$(".mode-btn"),
  exportBtn: $("#exportBtn"),
  editorStats: $("#editorStats"),
  paper: $("#paper"),
  textEditor: $("#textEditor"),
  noteText: $("#noteText"),
  inkEditor: $("#inkEditor"),
  inkBase: $("#inkBase"),
  inkLive: $("#inkLive"),
  inkEmpty: $("#inkEmpty"),
  inkToolbar: $("#inkToolbar"),
  toolGroup: $("#toolGroup"),
  swatches: $("#swatches"),
  widths: $("#widths"),
  undoBtn: $("#undoBtn"),
  redoBtn: $("#redoBtn"),
  clearInkBtn: $("#clearInkBtn"),

  aiRail: $("#aiRail"),
  aiSubtitle: $("#aiSubtitle"),
  aiStatusDot: $("#aiStatusDot"),
  aiTabs: $$(".ai-tab"),
  suggestPanel: $("#suggestPanel"),
  chatPanel: $("#chatPanel"),
  suggestCount: $("#suggestCount"),
  analyzeBtn: $("#analyzeBtn"),
  readingState: $("#readingState"),
  readingText: $("#readingText"),
  suggestLoading: $("#suggestLoading"),
  suggestError: $("#suggestError"),
  suggestErrorText: $("#suggestErrorText"),
  suggestRetryBtn: $("#suggestRetryBtn"),
  suggestSettingsBtn: $("#suggestSettingsBtn"),
  suggestList: $("#suggestList"),
  suggestEmpty: $("#suggestEmpty"),
  analyzeEmptyBtn: $("#analyzeEmptyBtn"),
  demoNotice: $("#demoNotice"),
  demoConfigBtn: $("#demoConfigBtn"),
  railFoot: $("#railFoot"),

  chatLog: $("#chatLog"),
  chatEmpty: $("#chatEmpty"),
  quickPrompts: $("#quickPrompts"),
  chatClearBtn: $("#chatClearBtn"),
  chatForm: $("#chatForm"),
  chatInput: $("#chatInput"),
  chatSend: $("#chatSend"),
  chatStop: $("#chatStop"),

  settingsDialog: $("#settingsDialog"),
  settingsForm: $("#settingsForm"),
  settingsClose: $("#settingsClose"),
  cancelSettingsBtn: $("#cancelSettingsBtn"),
  saveSettingsBtn: $("#saveSettingsBtn"),
  setProvider: $("#setProvider"),
  setBaseUrl: $("#setBaseUrl"),
  setModel: $("#setModel"),
  setApiKey: $("#setApiKey"),
  keyHint: $("#keyHint"),
  keyVisibility: $("#keyVisibility"),
  providerHelp: $("#providerHelp"),
  setVision: $("#setVision"),
  setAutoSuggest: $("#setAutoSuggest"),
  setDelay: $("#setDelay"),
  setCooldown: $("#setCooldown"),
  testBtn: $("#testBtn"),
  testResult: $("#testResult"),
  exportAllBtn: $("#exportAllBtn"),
  clearAllBtn: $("#clearAllBtn"),

  confirmDialog: $("#confirmDialog"),
  confirmTitle: $("#confirmTitle"),
  confirmBody: $("#confirmBody"),
  confirmOk: $("#confirmOk"),
  confirmCancel: $("#confirmCancel"),

  toast: $("#toast"),
};

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

let settings = normalizeSettings(loadSettings());
let db = loadDB();
let activeNoteId = db.activeId;

const ai = {
  tab: "suggest",
  suggestions: [],
  reading: "",
  suggesting: false,
  error: "",
  analyzed: false,
  lastAutoAt: 0,
  lastSignature: "",
  analyzeController: null,
  chatStreaming: false,
  chatController: null,
  lastQuestion: "",
};

const ui = {
  search: "",
  tool: "pen",
  pen: { color: PEN_COLORS[0].value, width: WIDTHS[1] },
  highlighter: { color: HIGHLIGHTER_COLORS[0].value, width: WIDTHS[1] },
};

let engine = null;
let engineNoteId = null;
let suggestTimer = 0;
let toastTimer = 0;
let saveWarned = false;
let clearingData = false;

const colorSchemeQuery = matchMedia("(prefers-color-scheme: dark)");

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

function boot() {
  if (!PROVIDERS[settings.provider]) settings.provider = "demo";
  if (!db.notes.length) {
    const note = createNote({ mode: "text" });
    db.notes.push(note);
    db.activeId = note.id;
  }
  if (!db.notes.some((note) => note.id === db.activeId)) db.activeId = db.notes[0].id;
  activeNoteId = db.activeId;
  saveDB(db);

  bindEvents();
  initInk();
  applyTheme();
  applyPaper();
  renderNotes();
  showNote(activeNote());
  renderAi();
  updateChatComposer();
  requestAnimationFrame(() => engine?.resize());

  if (colorSchemeQuery.addEventListener) {
    colorSchemeQuery.addEventListener("change", () => {
      if (settings.theme === "system") applyTheme();
    });
  }
  window.addEventListener("beforeunload", () => {
    ai.analyzeController?.abort();
    ai.chatController?.abort();
    if (!clearingData) persistNow();
  });
  window.addEventListener("resize", handleResize);
}

/* ------------------------------------------------------------------ */
/* Notes                                                               */
/* ------------------------------------------------------------------ */

function activeNote() {
  let note = db.notes.find((item) => item.id === activeNoteId);
  if (!note) {
    note = db.notes[0];
    if (!note) {
      note = createNote({ mode: "text" });
      db.notes.push(note);
    }
    activeNoteId = note.id;
    db.activeId = note.id;
  }
  return note;
}

const persistNow = () => {
  db.activeId = activeNoteId;
  const ok = saveDB(db);
  setSaveState(ok ? `已保存 ${formatClock()}` : "保存失败");
  if (!ok && !saveWarned) {
    saveWarned = true;
    showToast("无法保存到本机：浏览器存储空间可能已满。");
  }
};

const persistSoon = debounce(persistNow, 420);
const renderNotesSoon = debounce(renderNotes, 220);

function setSaveState(text) {
  els.saveState.textContent = text;
}

function markEdited({ notes = true, stats = true, analyze = true } = {}) {
  const note = activeNote();
  note.updatedAt = Date.now();
  setSaveState("编辑中…");
  persistSoon();
  if (notes) renderNotesSoon();
  if (stats) renderStats();
  if (analyze) scheduleAutoAnalyze();
}

function renderNotes() {
  const query = ui.search.trim().toLowerCase();
  const notes = db.notes
    .filter((note) => {
      if (!query) return true;
      return (
        note.title.toLowerCase().includes(query) || note.text.toLowerCase().includes(query)
      );
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);

  els.noteCount.textContent = `${db.notes.length} 篇`;
  els.noteList.replaceChildren();

  if (!notes.length) {
    const empty = document.createElement("div");
    empty.className = "note-empty";
    empty.textContent = query ? "没有找到相关笔记" : "还没有笔记，点「新建」开始。";
    els.noteList.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const note of notes) {
    const item = document.createElement("div");
    item.className = "note-item" + (note.id === activeNoteId ? " is-active" : "");
    item.dataset.id = note.id;
    item.setAttribute("role", "button");
    item.tabIndex = 0;
    item.setAttribute("aria-current", note.id === activeNoteId ? "true" : "false");

    const title = document.createElement("div");
    title.className = "note-item-title";
    title.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-${
      note.mode === "ink" ? "pen" : "keyboard"
    }"/></svg>`;
    const titleText = document.createElement("span");
    titleText.textContent = note.title || "未命名笔记";
    title.append(titleText);

    const preview = document.createElement("div");
    preview.className = "note-item-preview";
    preview.textContent = noteExcerpt(note);

    const meta = document.createElement("div");
    meta.className = "note-item-meta";
    meta.textContent = formatRelative(note.updatedAt);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "note-del";
    del.dataset.delete = note.id;
    del.title = "删除笔记";
    del.setAttribute("aria-label", `删除「${note.title}」`);
    del.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-trash"/></svg>';

    item.append(title, preview, meta, del);
    fragment.append(item);
  }
  els.noteList.append(fragment);
}

function showNote(note) {
  els.noteTitle.value = note.title === "未命名笔记" ? "" : note.title;
  els.noteTitle.placeholder = "未命名笔记";
  els.noteText.value = note.text;
  autoGrow(els.noteText);
  document.title = `${note.title || "未命名笔记"} · 随墨`;

  for (const button of els.modeButtons) {
    const isActive = button.dataset.mode === note.mode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  }

  const isInk = note.mode === "ink";
  els.paper.classList.toggle("mode-ink", isInk);
  els.paper.classList.toggle("mode-text", !isInk);
  els.textEditor.hidden = isInk;
  els.inkEditor.hidden = !isInk;
  els.inkToolbar.hidden = !isInk;

  if (engineNoteId !== note.id) {
    engineNoteId = note.id;
    engine?.setStrokes(note.strokes);
    els.textEditor.scrollTop = 0;
    els.chatLog.scrollTop = els.chatLog.scrollHeight;
  }

  renderStats();
  renderChat();
  syncToolbar();
  setSaveState("已保存");
  if (isInk) requestAnimationFrame(() => engine?.resize());
}

function renderStats() {
  const note = activeNote();
  const stats = noteStats(note);
  els.noteStatsTop.textContent = stats;
  els.editorStats.textContent = note.mode === "ink" ? `${note.strokes.length} 笔` : stats;
}

function selectNote(id) {
  if (id === activeNoteId) {
    closeDrawers();
    return;
  }
  const target = db.notes.find((note) => note.id === id);
  if (!target) return;
  persistNow();
  stopChat(true);
  ai.analyzeController?.abort();
  ai.analyzeController = null;
  clearTimeout(suggestTimer);
  suggestTimer = 0;

  activeNoteId = id;
  db.activeId = id;
  els.chatInput.value = "";
  autoGrow(els.chatInput);
  resetAiState();
  persistSoon();
  showNote(target);
  renderNotes();
  renderAi();
  closeDrawers();
}

function resetAiState() {
  ai.suggestions = [];
  ai.reading = "";
  ai.suggesting = false;
  ai.error = "";
  ai.analyzed = false;
  ai.lastAutoAt = 0;
  ai.lastSignature = "";
  ai.chatStreaming = false;
  ai.chatController = null;
  ai.lastQuestion = "";
}

function newNote() {
  persistNow();
  stopChat(true);
  ai.analyzeController?.abort();
  ai.analyzeController = null;
  clearTimeout(suggestTimer);

  const note = createNote({ mode: activeNote().mode });
  db.notes.unshift(note);
  activeNoteId = note.id;
  db.activeId = note.id;
  resetAiState();
  persistNow();
  showNote(note);
  renderNotes();
  renderAi();
  closeDrawers();
  if (note.mode === "text") {
    requestAnimationFrame(() => els.noteText.focus());
  }
  showToast(note.mode === "ink" ? "已新建一页手写笔记" : "已新建一页文字笔记");
}

async function deleteNote(id) {
  const note = db.notes.find((item) => item.id === id);
  if (!note) return;
  const ok = await confirmAction({
    title: "删除这页笔记？",
    body: `「${note.title || "未命名笔记"}」及其对话会从本机永久删除。`,
    okText: "删除",
  });
  if (!ok) return;

  if (id === activeNoteId) {
    stopChat(true);
    ai.analyzeController?.abort();
    clearTimeout(suggestTimer);
  }
  const index = db.notes.findIndex((item) => item.id === id);
  db.notes.splice(index, 1);
  if (!db.notes.length) {
    const fallback = createNote({ mode: "text" });
    db.notes.push(fallback);
  }
  if (id === activeNoteId) {
    const next = db.notes[Math.min(index, db.notes.length - 1)];
    activeNoteId = next.id;
    db.activeId = next.id;
    resetAiState();
    showNote(next);
    renderAi();
  }
  persistNow();
  renderNotes();
  showToast("笔记已删除");
}

function setMode(mode) {
  const note = activeNote();
  if (note.mode === mode) return;
  note.mode = mode;
  note.updatedAt = Date.now();
  ai.suggestions = [];
  ai.reading = "";
  ai.error = "";
  ai.analyzed = false;
  ai.lastSignature = "";
  persistSoon();
  showNote(note);
  renderNotesSoon();
  renderAi();
  updateChatComposer();
  if (mode === "ink") requestAnimationFrame(() => engine?.resize());
  scheduleAutoAnalyze();
}

/* ------------------------------------------------------------------ */
/* Ink                                                                 */
/* ------------------------------------------------------------------ */

function initInk() {
  engine = new InkEngine({
    baseCanvas: els.inkBase,
    liveCanvas: els.inkLive,
    container: els.inkEditor,
    onChange: (strokes) => {
      const note = activeNote();
      if (engineNoteId !== note.id) return;
      note.strokes = strokes;
      note.updatedAt = Date.now();
      renderStats();
      setSaveState("编辑中…");
      persistSoon();
      renderNotesSoon();
      scheduleAutoAnalyze();
    },
    onHistory: ({ canUndo, canRedo }) => {
      els.undoBtn.disabled = !canUndo;
      els.redoBtn.disabled = !canRedo;
    },
    onEmptyChange: (empty) => {
      els.inkEmpty.classList.toggle("is-hidden", !empty);
    },
  });
  engine.setTool(ui.tool);
  engine.setColor(currentToolPrefs().color);
  engine.setWidth(currentToolPrefs().width);
  renderSwatches();
  renderWidths();
  syncToolbar();
}

function currentToolPrefs() {
  return ui.tool === "highlighter" ? ui.highlighter : ui.pen;
}

function setTool(tool) {
  if (!["pen", "highlighter", "eraser"].includes(tool)) return;
  ui.tool = tool;
  engine?.setTool(tool);
  const prefs = currentToolPrefs();
  engine?.setColor(prefs.color);
  engine?.setWidth(tool === "eraser" ? 16 : prefs.width);
  syncToolbar();
  renderSwatches();
  renderWidths();
}

function syncToolbar() {
  for (const button of els.toolGroup.querySelectorAll("[data-tool]")) {
    const active = button.dataset.tool === ui.tool;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  const eraser = ui.tool === "eraser";
  els.swatches.hidden = eraser;
  els.widths.hidden = eraser;
  const swatchDivider = els.swatches.previousElementSibling;
  const widthDivider = els.widths.previousElementSibling;
  if (swatchDivider) swatchDivider.hidden = eraser;
  if (widthDivider) widthDivider.hidden = eraser;
}

function renderSwatches() {
  const palette = ui.tool === "highlighter" ? HIGHLIGHTER_COLORS : PEN_COLORS;
  const current = currentToolPrefs().color;
  els.swatches.replaceChildren();
  for (const color of palette) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "swatch" + (color.value === current ? " is-active" : "");
    button.style.background = color.value;
    button.dataset.color = color.value;
    button.title = color.name;
    button.setAttribute("aria-label", `墨色：${color.name}`);
    button.setAttribute("aria-pressed", String(color.value === current));
    els.swatches.append(button);
  }
}

function renderWidths() {
  const current = currentToolPrefs().width;
  const dotSizes = [5, 8, 11];
  els.widths.replaceChildren();
  WIDTHS.forEach((width, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "width-btn" + (width === current ? " is-active" : "");
    button.dataset.width = String(width);
    button.title = `笔迹粗细 ${index + 1}`;
    button.setAttribute("aria-label", `笔迹粗细 ${index + 1}`);
    const dot = document.createElement("span");
    dot.style.width = `${dotSizes[index]}px`;
    dot.style.height = `${dotSizes[index]}px`;
    button.append(dot);
    button.setAttribute("aria-pressed", String(width === current));
    els.widths.append(button);
  });
}

/* ------------------------------------------------------------------ */
/* AI suggestions                                                      */
/* ------------------------------------------------------------------ */

function setAiError(message) {
  ai.error = message;
  ai.analyzed = false;
  renderAi();
}

function scheduleAutoAnalyze() {
  clearTimeout(suggestTimer);
  suggestTimer = 0;
  if (!settings.autoSuggest) return;
  const note = activeNote();
  if (!note) return;
  const hasContent = note.mode === "ink" ? note.strokes.length > 0 : note.text.trim().length > 0;
  if (!hasContent) return;
  if (!isDemo(settings) && !isConfigured(settings)) return;
  if (note.mode === "ink" && !isDemo(settings) && !settings.vision) return;
  if (ai.suggesting) return;

  const signature = noteSignature(note);
  if (signature === ai.lastSignature) return;
  const cooldownLeft = Math.max(0, ai.lastAutoAt + settings.cooldown * 1000 - Date.now());
  const wait = Math.max(settings.delay, cooldownLeft);
  suggestTimer = window.setTimeout(() => {
    suggestTimer = 0;
    if (!settings.autoSuggest) return;
    const current = activeNote();
    if (noteSignature(current) !== signature) {
      scheduleAutoAnalyze();
      return;
    }
    runAnalysis({ manual: false });
  }, wait);
}

async function runAnalysis({ manual = false } = {}) {
  if (ai.suggesting) return;
  const note = activeNote();
  const hasContent = note.mode === "ink" ? note.strokes.length > 0 : note.text.trim().length > 0;
  if (!hasContent) {
    if (manual) showToast("先写一点内容，我再来读。");
    return;
  }
  if (!isDemo(settings) && !isConfigured(settings)) {
    setAiError("尚未完成 AI 配置。请在设置中填写服务商、模型与 API Key。");
    if (manual) switchAiTab("suggest");
    return;
  }
  if (note.mode === "ink" && !isDemo(settings) && !settings.vision) {
    setAiError("手写模式需要支持图片输入的模型。请在设置中开启「手写页面视觉识别」，或切换到文字笔记。");
    if (manual) switchAiTab("suggest");
    return;
  }

  const signature = noteSignature(note);
  let imageDataUrl = null;
  if (note.mode === "ink") {
    try {
      imageDataUrl = engine.exportDataUrl({ maxDim: 1280, type: "image/jpeg", quality: 0.84 });
    } catch {
      setAiError("无法读取手写画布，请刷新页面后重试。");
      return;
    }
  }

  ai.suggesting = true;
  ai.error = "";
  ai.analyzed = false;
  const controller = new AbortController();
  ai.analyzeController = controller;
  if (manual) switchAiTab("suggest");
  renderAi();

  try {
    let result;
    if (isDemo(settings)) {
      result = await demoAnalyzeStream({ note, signal: controller.signal });
    } else {
      result = await analyzeNote({
        settings,
        note,
        imageDataUrl,
        signal: controller.signal,
        previousSuggestions: ai.suggestions,
      });
    }
    if (controller.signal.aborted || activeNote().id !== note.id) return;
    ai.suggestions = result.suggestions;
    ai.reading = result.reading;
    ai.analyzed = true;
    ai.lastSignature = signature;
    ai.lastAutoAt = Date.now();
    if (manual && !result.suggestions.length) {
      showToast("这页暂时没有需要补充的地方。");
    }
  } catch (error) {
    if (controller.signal.aborted) return;
    ai.error =
      error?.name === "AbortError"
        ? "分析已取消。"
        : error?.message || "分析失败，请稍后重试。";
    ai.analyzed = false;
  } finally {
    if (ai.analyzeController === controller) {
      ai.analyzeController = null;
      ai.suggesting = false;
    }
    if (activeNote().id === note.id) renderAi();
    if (!controller.signal.aborted && noteSignature(activeNote()) !== signature) {
      scheduleAutoAnalyze();
    }
  }
}

function renderSuggestions() {
  const note = activeNote();

  els.readingState.hidden = !ai.reading || ai.suggesting || Boolean(ai.error);
  els.readingText.textContent = ai.reading || "";
  els.suggestLoading.hidden = !ai.suggesting;
  els.suggestError.hidden = !ai.error || ai.suggesting;
  els.suggestErrorText.textContent = ai.error || "";
  els.suggestList.replaceChildren();

  const hasSuggestions = ai.suggestions.length > 0;
  const showEmpty = !ai.suggesting && !ai.error && !hasSuggestions;
  els.suggestEmpty.hidden = !showEmpty;

  if (showEmpty) {
    const heading = els.suggestEmpty.querySelector("h3");
    const copy = els.suggestEmpty.querySelector("p");
    const button = els.analyzeEmptyBtn;
    if (ai.analyzed) {
      heading.textContent = "暂时没有新的建议";
      copy.textContent = "继续写一点，或稍后再让我看看。";
      button.textContent = "再分析一次";
    } else {
      heading.textContent = "AI 会陪你一起写";
      copy.textContent = "当你停下笔，我会读一读这页笔记，给出简短的提示、追问或拓展。";
      button.textContent = "分析当前笔记";
    }
  }

  if (!hasSuggestions) return;

  const fragment = document.createDocumentFragment();
  ai.suggestions.forEach((suggestion, index) => {
    const type = SUGGESTION_TYPES[suggestion.type] ?? SUGGESTION_TYPES.insight;
    const card = document.createElement("article");
    card.className = `suggestion ${type.className}`;
    card.style.animationDelay = `${index * 45}ms`;

    const head = document.createElement("div");
    head.className = "suggestion-head";
    const typeLabel = document.createElement("span");
    typeLabel.className = "sugg-type";
    typeLabel.innerHTML = `<i></i>${type.label}`;
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "sugg-dismiss";
    dismiss.dataset.dismiss = String(index);
    dismiss.title = "忽略这条建议";
    dismiss.setAttribute("aria-label", "忽略这条建议");
    dismiss.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-close"/></svg>';
    head.append(typeLabel, dismiss);

    const title = document.createElement("h3");
    title.textContent = suggestion.title;
    const body = document.createElement("p");
    body.textContent = suggestion.body;

    const foot = document.createElement("div");
    foot.className = "suggestion-foot";
    const adopt = document.createElement("button");
    adopt.type = "button";
    adopt.className = "mini-btn";
    adopt.dataset.adopt = String(index);
    adopt.textContent = note.mode === "ink" ? "复制建议" : "记入笔记";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "icon-mini";
    copy.dataset.copy = String(index);
    copy.title = "复制";
    copy.setAttribute("aria-label", "复制这条建议");
    copy.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-copy"/></svg>';
    foot.append(adopt, copy);

    card.append(head, title, body, foot);
    fragment.append(card);
  });
  els.suggestList.append(fragment);
}

function adoptSuggestion(index) {
  const suggestion = ai.suggestions[index];
  if (!suggestion) return;
  const note = activeNote();
  if (note.mode === "ink") {
    copySuggestion(suggestion);
    return;
  }
  const addition = `【${suggestion.title}】${suggestion.body}`;
  note.text = `${note.text.replace(/\s*$/, "")}${note.text.trim() ? "\n\n" : ""}${addition}`;
  els.noteText.value = note.text;
  autoGrow(els.noteText);
  note.updatedAt = Date.now();
  ai.suggestions.splice(index, 1);
  markEdited({ notes: true, stats: true, analyze: false });
  els.textEditor.scrollTop = els.textEditor.scrollHeight;
  renderAi();
  showToast("已记入当前笔记");
}

async function copySuggestion(suggestion) {
  const ok = await copyText(`${suggestion.title}\n${suggestion.body}`);
  showToast(ok ? "建议已复制" : "复制失败，请手动选择文字");
}

function dismissSuggestion(index) {
  ai.suggestions.splice(index, 1);
  if (!ai.suggestions.length) ai.analyzed = true;
  renderAi();
}

/* ------------------------------------------------------------------ */
/* Chat                                                                */
/* ------------------------------------------------------------------ */

const scheduleChatRender = rafThrottle(() => renderChat());

function ensureChat(note) {
  if (!Array.isArray(note.chat)) note.chat = [];
  return note.chat;
}

function renderChat() {
  const note = activeNote();
  const messages = ensureChat(note);
  const wasNearBottom =
    els.chatLog.scrollHeight - els.chatLog.scrollTop - els.chatLog.clientHeight < 100;

  const hasMessages = messages.length > 0;
  els.chatEmpty.hidden = hasMessages;
  els.quickPrompts.hidden = hasMessages;
  els.chatClearBtn.hidden = !hasMessages || ai.chatStreaming;
  els.chatLog.hidden = !hasMessages;
  els.chatLog.replaceChildren();

  if (!hasMessages) {
    updateChatComposer();
    return;
  }

  const fragment = document.createDocumentFragment();
  messages.forEach((message, index) => {
    if (message.role === "user") {
      const wrap = document.createElement("div");
      wrap.className = "chat-msg user";
      wrap.dataset.index = String(index);
      const bubble = document.createElement("div");
      bubble.className = "chat-user-bubble";
      bubble.textContent = message.content;
      wrap.append(bubble);
      fragment.append(wrap);
      return;
    }

    const wrap = document.createElement("div");
    wrap.className = "chat-msg assistant";
    wrap.dataset.index = String(index);
    if (message.streaming) wrap.classList.add("is-streaming");

    const avatar = document.createElement("div");
    avatar.className = "chat-avatar";
    avatar.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-sparkles"/></svg>';

    const bubble = document.createElement("div");
    bubble.className = "chat-ai-bubble";
    if (message.error) {
      bubble.classList.add("is-error");
      const text = document.createElement("p");
      text.textContent = message.error;
      bubble.append(text);
      const actions = document.createElement("div");
      actions.className = "chat-error-actions";
      const settingsButton = document.createElement("button");
      settingsButton.type = "button";
      settingsButton.className = "mini-btn ghost";
      settingsButton.dataset.chatSettings = "1";
      settingsButton.textContent = "打开设置";
      actions.append(settingsButton);
      bubble.append(actions);
    } else if (message.streaming && !message.content) {
      bubble.innerHTML =
        '<span class="typing-dots" aria-label="AI 正在思考"><i></i><i></i><i></i></span>';
    } else {
      const content = document.createElement("div");
      content.className = "md";
      content.innerHTML = renderMarkdown(message.content);
      bubble.append(content);
    }

    const body = document.createElement("div");
    body.append(bubble);
    if (isDemo(settings) && !message.error) {
      const meta = document.createElement("div");
      meta.className = "chat-meta";
      meta.textContent = message.streaming ? "本地演示 · 正在生成" : "本地演示";
      body.append(meta);
    }
    wrap.append(avatar, body);
    fragment.append(wrap);
  });

  els.chatLog.append(fragment);
  if (wasNearBottom) {
    els.chatLog.scrollTop = els.chatLog.scrollHeight;
  }
  updateChatComposer();
}

function updateChatComposer() {
  const hasText = els.chatInput.value.trim().length > 0;
  els.chatSend.hidden = ai.chatStreaming;
  els.chatStop.hidden = !ai.chatStreaming;
  els.chatSend.disabled = !hasText;
  els.chatInput.disabled = false;
}

async function sendChat(question) {
  const text = String(question || "").trim();
  if (!text || ai.chatStreaming) return;
  const note = activeNote();
  const messages = ensureChat(note);

  const history = messages.slice(-10).map((message) => ({ ...message }));
  messages.push({ role: "user", content: text, at: Date.now() });
  ai.lastQuestion = text;
  els.chatInput.value = "";
  autoGrow(els.chatInput);
  ai.chatStreaming = true;
  switchAiTab("chat");

  if (!isDemo(settings) && !isConfigured(settings)) {
    messages.push({
      role: "assistant",
      content: "",
      at: Date.now(),
      error: "尚未完成 AI 配置。填写 Base URL、模型与 API Key 后即可对话。",
    });
    ai.chatStreaming = false;
    renderChat();
    renderAi();
    renderNotesSoon();
    persistSoon();
    return;
  }

  let imageDataUrl = null;
  if (note.mode === "ink" && settings.vision && !isDemo(settings)) {
    try {
      imageDataUrl = engine.exportDataUrl({ maxDim: 1280, type: "image/jpeg", quality: 0.84 });
    } catch {
      imageDataUrl = null;
    }
  }

  const assistant = { role: "assistant", content: "", at: Date.now(), streaming: true };
  messages.push(assistant);
  const controller = new AbortController();
  ai.chatController = controller;
  renderChat();
  renderAi();

  try {
    if (isDemo(settings)) {
      await demoChatStream({
        note,
        question: text,
        signal: controller.signal,
        onToken: (token) => {
          assistant.content += token;
          scheduleChatRender();
        },
      });
    } else {
      await streamAnswer({
        settings,
        note,
        imageDataUrl,
        history,
        question: text,
        signal: controller.signal,
        onToken: (token) => {
          assistant.content += token;
          scheduleChatRender();
        },
      });
    }
    if (controller.signal.aborted) {
      if (!assistant.content.trim()) assistant.content = "（已停止）";
    }
  } catch (error) {
    if (controller.signal.aborted) {
      if (!assistant.content.trim()) assistant.content = "（已停止）";
    } else {
      assistant.error = error?.message || "回答失败，请稍后重试。";
    }
  } finally {
    assistant.streaming = false;
    if (ai.chatController === controller) {
      ai.chatController = null;
      ai.chatStreaming = false;
    }
    note.chat = messages.filter((message) => message.content || message.error).slice(-40);
    note.updatedAt = Date.now();
    persistSoon();
    renderNotesSoon();
    if (note.id === activeNoteId) {
      renderChat();
      renderAi();
    }
  }
}

function stopChat(silent = false) {
  if (!ai.chatController) {
    ai.chatStreaming = false;
    return;
  }
  ai.chatController.abort();
  // Keep `chatStreaming` true until the stream's finally block runs. This
  // prevents a new message from racing the previous stream's final flush.
  if (!silent) {
    renderChat();
    renderAi();
  }
}

function clearChat() {
  const note = activeNote();
  if (!note.chat?.length) return;
  if (ai.chatStreaming) stopChat(true);
  confirmAction({
    title: "清空这页的对话？",
    body: "只删除对话记录，不会影响笔记内容。",
    okText: "清空",
  }).then((ok) => {
    if (!ok) return;
    note.chat = [];
    ai.lastQuestion = "";
    persistSoon();
    renderChat();
    renderAi();
    showToast("对话已清空");
  });
}

/* ------------------------------------------------------------------ */
/* AI chrome                                                           */
/* ------------------------------------------------------------------ */

function switchAiTab(tab) {
  if (!["suggest", "chat"].includes(tab)) return;
  ai.tab = tab;
  renderAiTabs();
}

function renderAiTabs() {
  for (const button of els.aiTabs) {
    const active = button.dataset.aiTab === ai.tab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  }
  els.suggestPanel.hidden = ai.tab !== "suggest";
  els.chatPanel.hidden = ai.tab !== "chat";
  const count = ai.suggestions.length;
  els.suggestCount.hidden = ai.tab === "suggest" || count === 0;
  els.suggestCount.textContent = String(count);
}

function renderAiChrome() {
  const note = activeNote();
  const demo = isDemo(settings);
  const configured = isConfigured(settings);
  const inkNeedsVision = note.mode === "ink" && !demo && !settings.vision;

  let subtitle = "正在关注你的笔记";
  let dotClass = "";
  if (!settings.autoSuggest) {
    subtitle = "实时建议已暂停";
    dotClass = "is-off";
  } else if (demo) {
    subtitle = "演示模式 · 正在关注你的笔记";
  } else if (!configured) {
    subtitle = "尚未连接 AI · 请在设置中配置";
    dotClass = "is-warn";
  } else if (inkNeedsVision) {
    subtitle = "手写识别未开启 · 文字笔记仍可用";
    dotClass = "is-warn";
  }
  els.aiSubtitle.textContent = subtitle;
  els.aiStatusDot.className = `status-dot ${dotClass}`;

  els.aiToggle.classList.toggle("is-on", settings.autoSuggest);
  els.aiToggle.classList.toggle("is-off", !settings.autoSuggest);
  els.aiToggle.setAttribute("aria-pressed", String(settings.autoSuggest));
  els.aiPillLabel.textContent = settings.autoSuggest ? "实时建议" : "已暂停";

  els.apiDot.classList.toggle("is-live", !demo && configured);
  if (demo) {
    els.apiLabel.textContent = "本地演示模式";
    els.apiSub.textContent = "配置 API Key 连接真实模型";
  } else {
    els.apiLabel.textContent = `${providerLabel(settings)}${settings.model ? ` · ${truncate(settings.model, 16)}` : ""}`;
    els.apiSub.textContent = configured ? "已连接 · 点击修改设置" : "尚未完成配置";
  }

  els.demoNotice.hidden = !demo;
  els.railFoot.textContent = demo
    ? "演示回答由内置示例生成；连接后只发送当前笔记的必要内容。"
    : "生成建议时只会把当前笔记的必要内容发送给你配置的 AI 服务。";

  els.analyzeBtn.classList.toggle("is-spinning", ai.suggesting);
  els.analyzeBtn.disabled = ai.suggesting;
}

function renderAi() {
  renderAiTabs();
  renderSuggestions();
  renderChat();
  renderAiChrome();
  updateChatComposer();
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

function applyTheme() {
  const resolved =
    settings.theme === "system" ? (colorSchemeQuery.matches ? "dark" : "light") : settings.theme;
  document.documentElement.dataset.theme = resolved;
  const use = els.themeBtn.querySelector("use");
  use?.setAttribute("href", resolved === "dark" ? "#i-sun" : "#i-moon");
  els.themeBtn.setAttribute("aria-label", resolved === "dark" ? "切换到浅色主题" : "切换到深色主题");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    if (bg) meta.setAttribute("content", bg);
  }
}

function applyPaper() {
  els.paper.dataset.paper = settings.paper;
}

function applySettings() {
  saveSettings(settings);
  applyTheme();
  applyPaper();
  renderAi();
  renderChat();
  if (!settings.autoSuggest) {
    clearTimeout(suggestTimer);
    suggestTimer = 0;
  } else {
    scheduleAutoAnalyze();
  }
  updateChatComposer();
}

function openSettings() {
  els.setProvider.value = PROVIDERS[settings.provider] ? settings.provider : "custom";
  els.setBaseUrl.value = settings.baseUrl;
  els.setModel.value = settings.model;
  els.setApiKey.value = settings.apiKey;
  els.setApiKey.type = "password";
  els.keyVisibility.innerHTML = '<svg class="icon"><use href="#i-eye"/></svg>';
  els.keyVisibility.setAttribute("aria-label", "显示 API Key");
  els.setVision.checked = settings.vision;
  els.setAutoSuggest.checked = settings.autoSuggest;
  els.setDelay.value = String(settings.delay);
  els.setCooldown.value = String(settings.cooldown);
  els.testResult.textContent = "";
  els.testResult.className = "test-result";
  for (const input of $$('input[name="theme"]')) input.checked = input.value === settings.theme;
  for (const input of $$('input[name="paper"]')) input.checked = input.value === settings.paper;
  syncProviderForm(settings.provider, { fillDefaults: false });
  els.settingsDialog.showModal();
}

function syncProviderForm(providerId, { fillDefaults = false } = {}) {
  const provider = PROVIDERS[providerId] ?? PROVIDERS.custom;
  if (fillDefaults) {
    if (providerId === "demo") {
      // Keep the last real endpoint so switching back is painless.
      els.setVision.checked = true;
    } else {
      els.setBaseUrl.value = provider.baseUrl;
      els.setModel.value = provider.model;
      els.setVision.checked = provider.vision;
    }
    els.testResult.textContent = "";
    els.testResult.className = "test-result";
  }
  const demo = providerId === "demo";
  els.setBaseUrl.disabled = demo;
  els.setModel.disabled = demo;
  els.setApiKey.disabled = demo;
  els.setVision.disabled = demo;
  els.testBtn.disabled = demo;
  els.keyHint.replaceChildren();
  if (provider.keyUrl) {
    const link = document.createElement("a");
    link.href = provider.keyUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "获取 Key ↗";
    els.keyHint.append(link);
  }
  els.providerHelp.textContent = demo
    ? "演示模式不会发起任何网络请求。切换到真实服务商后，密钥只保存在本机浏览器。"
    : `${provider.hint} Key 只保存在本机浏览器，并直接发送到上面的 Base URL。`;
}

function formSettings() {
  return {
    ...settings,
    provider: els.setProvider.value,
    baseUrl: els.setBaseUrl.value.trim(),
    model: els.setModel.value.trim(),
    apiKey: els.setApiKey.value.trim(),
    vision: els.setVision.checked,
    autoSuggest: els.setAutoSuggest.checked,
    delay: Number(els.setDelay.value),
    cooldown: Number(els.setCooldown.value),
    theme: document.querySelector('input[name="theme"]:checked')?.value ?? settings.theme,
    paper: document.querySelector('input[name="paper"]:checked')?.value ?? settings.paper,
  };
}

function showFormMessage(message, ok = false) {
  els.testResult.textContent = message;
  els.testResult.className = `test-result ${ok ? "is-ok" : "is-error"}`;
}

function saveSettingsFromForm() {
  const draft = formSettings();
  if (draft.provider !== "demo") {
    if (!draft.baseUrl) {
      showFormMessage("请填写 Base URL。");
      els.setBaseUrl.focus();
      return;
    }
    try {
      const url = new URL(draft.baseUrl);
      if (!/^https?:$/.test(url.protocol)) throw new Error("protocol");
    } catch {
      showFormMessage("Base URL 需要是有效的 http(s) 地址。");
      els.setBaseUrl.focus();
      return;
    }
    if (!draft.model) {
      showFormMessage("请填写模型名称。");
      els.setModel.focus();
      return;
    }
  }
  settings = normalizeSettings(draft);
  applySettings();
  els.settingsDialog.close();
  showToast(
    settings.provider !== "demo" && !settings.apiKey
      ? "设置已保存；填写 API Key 后即可连接。"
      : "设置已保存",
  );
}

async function runConnectionTest() {
  const draft = normalizeSettings(formSettings());
  els.testBtn.disabled = true;
  showFormMessage("正在连接…");
  try {
    const result = await testConnection({ settings: draft });
    showFormMessage(result.message, true);
  } catch (error) {
    if (error?.name === "AbortError") return;
    showFormMessage(error?.message || "连接失败。");
  } finally {
    els.testBtn.disabled = draft.provider === "demo";
  }
}

function exportAll() {
  const payload = {
    app: "suimo",
    exportedAt: new Date().toISOString(),
    version: 1,
    notes: db.notes,
    settings: { ...settings, apiKey: "" },
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  downloadBlob(blob, `suimo-notes-${new Date().toISOString().slice(0, 10)}.json`);
  showToast("已导出全部笔记（不含 API Key）");
}

async function clearEverything() {
  const ok = await confirmAction({
    title: "清除全部数据？",
    body: "所有笔记、对话与 API Key 都会被删除，且无法恢复。",
    okText: "全部删除",
  });
  if (!ok) return;
  clearingData = true;
  ai.analyzeController?.abort();
  ai.chatController?.abort();
  clearAll();
  location.reload();
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

function exportCurrent() {
  const note = activeNote();
  const filename = safeFilename(note.title || "随墨笔记");
  if (note.mode === "ink") {
    if (!note.strokes.length) {
      showToast("这页还没有内容可导出。");
      return;
    }
    const url = engine.exportDataUrl({
      maxDim: 2200,
      type: "image/png",
      background: "#fffdf8",
    });
    const link = document.createElement("a");
    link.href = url;
    link.download = `${filename}.png`;
    document.body.append(link);
    link.click();
    link.remove();
    showToast("已导出手写页面");
    return;
  }
  if (!note.text.trim()) {
    showToast("这页还没有内容可导出。");
    return;
  }
  const blob = new Blob([`# ${note.title}\n\n${note.text}\n`], { type: "text/markdown;charset=utf-8" });
  downloadBlob(blob, `${filename}.md`);
  showToast("已导出 Markdown");
}

/* ------------------------------------------------------------------ */
/* Theme / layout                                                      */
/* ------------------------------------------------------------------ */

function toggleTheme() {
  const resolved =
    settings.theme === "system" ? (colorSchemeQuery.matches ? "dark" : "light") : settings.theme;
  settings.theme = resolved === "dark" ? "light" : "dark";
  saveSettings(settings);
  applyTheme();
  showToast(settings.theme === "dark" ? "已切换到深色主题" : "已切换到浅色主题");
}

function toggleAutoSuggest() {
  settings.autoSuggest = !settings.autoSuggest;
  saveSettings(settings);
  if (!settings.autoSuggest) {
    clearTimeout(suggestTimer);
    suggestTimer = 0;
  } else {
    scheduleAutoAnalyze();
  }
  renderAiChrome();
  showToast(settings.autoSuggest ? "实时建议已开启" : "实时建议已暂停");
}

function openSidebar() {
  els.app.classList.add("sidebar-open");
  els.app.classList.remove("ai-open");
  updateScrim();
}

function openAiDrawer() {
  els.app.classList.add("ai-open");
  els.app.classList.remove("sidebar-open");
  updateScrim();
}

function closeDrawers() {
  els.app.classList.remove("sidebar-open", "ai-open");
  updateScrim();
}

function updateScrim() {
  const open =
    els.app.classList.contains("sidebar-open") || els.app.classList.contains("ai-open");
  els.scrim.hidden = !open;
}

function handleResize() {
  if (innerWidth > 960) els.app.classList.remove("sidebar-open");
  if (innerWidth > 1120) els.app.classList.remove("ai-open");
  updateScrim();
  autoGrow(els.noteText);
  autoGrow(els.chatInput);
}

/* ------------------------------------------------------------------ */
/* Toast & confirm                                                     */
/* ------------------------------------------------------------------ */

function showToast(message, duration = 2600) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => els.toast.classList.remove("is-visible"), duration);
}

function confirmAction({ title, body, okText = "确认" }) {
  els.confirmTitle.textContent = title;
  els.confirmBody.textContent = body;
  els.confirmOk.textContent = okText;
  els.confirmDialog.showModal();

  return new Promise((resolve) => {
    function cleanup(result) {
      els.confirmOk.removeEventListener("click", onOk);
      els.confirmCancel.removeEventListener("click", onCancel);
      els.confirmDialog.removeEventListener("cancel", onCancelEvent);
      els.confirmDialog.close();
      resolve(result);
    }
    function onOk() {
      cleanup(true);
    }
    function onCancel() {
      cleanup(false);
    }
    function onCancelEvent(event) {
      event.preventDefault();
      cleanup(false);
    }
    els.confirmOk.addEventListener("click", onOk);
    els.confirmCancel.addEventListener("click", onCancel);
    els.confirmDialog.addEventListener("cancel", onCancelEvent);
  });
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

function bindEvents() {
  els.sidebarToggle.addEventListener("click", openSidebar);
  els.aiDrawerBtn.addEventListener("click", openAiDrawer);
  els.aiRailClose.addEventListener("click", closeDrawers);
  els.scrim.addEventListener("click", closeDrawers);
  els.themeBtn.addEventListener("click", toggleTheme);
  els.settingsBtn.addEventListener("click", openSettings);
  els.aiToggle.addEventListener("click", toggleAutoSuggest);
  els.apiCard.addEventListener("click", openSettings);

  els.noteTitle.addEventListener("input", () => {
    const note = activeNote();
    note.title = els.noteTitle.value.trim() || "未命名笔记";
    note.titleAuto = false;
    note.updatedAt = Date.now();
    document.title = `${note.title} · 随墨`;
    setSaveState("编辑中…");
    persistSoon();
    renderNotesSoon();
  });
  els.noteTitle.addEventListener("blur", () => {
    const note = activeNote();
    if (!els.noteTitle.value.trim()) {
      els.noteTitle.value = "";
      note.title = "未命名笔记";
    }
  });

  els.noteText.addEventListener("input", (event) => {
    const note = activeNote();
    note.text = els.noteText.value;
    note.updatedAt = Date.now();
    if (note.titleAuto && !event.isComposing) {
      const derived = deriveTitle(note.text);
      if (derived && derived !== note.title) {
        note.title = derived;
        if (document.activeElement !== els.noteTitle) els.noteTitle.value = derived === "未命名笔记" ? "" : derived;
        document.title = `${derived} · 随墨`;
      }
    }
    autoGrow(els.noteText);
    markEdited();
  });

  els.textEditor.addEventListener("click", (event) => {
    if (event.target === els.textEditor) els.noteText.focus();
  });

  for (const button of els.modeButtons) {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  }

  els.exportBtn.addEventListener("click", exportCurrent);

  els.toolGroup.addEventListener("click", (event) => {
    const button = event.target.closest("[data-tool]");
    if (button) setTool(button.dataset.tool);
  });
  els.swatches.addEventListener("click", (event) => {
    const button = event.target.closest("[data-color]");
    if (!button) return;
    const prefs = currentToolPrefs();
    prefs.color = button.dataset.color;
    engine.setColor(prefs.color);
    renderSwatches();
    syncToolbar();
  });
  els.widths.addEventListener("click", (event) => {
    const button = event.target.closest("[data-width]");
    if (!button) return;
    const prefs = currentToolPrefs();
    prefs.width = Number(button.dataset.width);
    engine.setWidth(prefs.width);
    renderWidths();
  });
  els.undoBtn.addEventListener("click", () => engine.undo());
  els.redoBtn.addEventListener("click", () => engine.redo());
  els.clearInkBtn.addEventListener("click", () => {
    if (engine.clear()) {
      showToast("已清空画布，可撤销");
    }
  });

  els.aiTabs.forEach((button) => {
    button.addEventListener("click", () => switchAiTab(button.dataset.aiTab));
  });
  els.analyzeBtn.addEventListener("click", () => runAnalysis({ manual: true }));
  els.analyzeEmptyBtn.addEventListener("click", () => runAnalysis({ manual: true }));
  els.suggestRetryBtn.addEventListener("click", () => runAnalysis({ manual: true }));
  els.suggestSettingsBtn.addEventListener("click", openSettings);
  els.demoConfigBtn.addEventListener("click", openSettings);

  els.suggestList.addEventListener("click", (event) => {
    const dismiss = event.target.closest("[data-dismiss]");
    if (dismiss) {
      dismissSuggestion(Number(dismiss.dataset.dismiss));
      return;
    }
    const adopt = event.target.closest("[data-adopt]");
    if (adopt) {
      adoptSuggestion(Number(adopt.dataset.adopt));
      return;
    }
    const copy = event.target.closest("[data-copy]");
    if (copy) {
      const suggestion = ai.suggestions[Number(copy.dataset.copy)];
      if (suggestion) copySuggestion(suggestion);
    }
  });

  els.chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    sendChat(els.chatInput.value);
  });
  els.chatInput.addEventListener("input", () => {
    autoGrow(els.chatInput);
    updateChatComposer();
  });
  els.chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendChat(els.chatInput.value);
    }
  });
  els.chatStop.addEventListener("click", () => stopChat());
  els.chatClearBtn.addEventListener("click", clearChat);
  els.chatLog.addEventListener("click", (event) => {
    if (event.target.closest("[data-chat-settings]")) openSettings();
  });
  els.quickPrompts.addEventListener("click", (event) => {
    const button = event.target.closest("[data-prompt]");
    if (button) sendChat(button.dataset.prompt);
  });

  els.settingsClose.addEventListener("click", () => els.settingsDialog.close());
  els.cancelSettingsBtn.addEventListener("click", () => els.settingsDialog.close());
  els.settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveSettingsFromForm();
  });
  els.settingsDialog.addEventListener("click", (event) => {
    if (event.target === els.settingsDialog) els.settingsDialog.close();
  });
  els.setProvider.addEventListener("change", () => {
    syncProviderForm(els.setProvider.value, { fillDefaults: true });
  });
  els.keyVisibility.addEventListener("click", () => {
    const showing = els.setApiKey.type === "text";
    els.setApiKey.type = showing ? "password" : "text";
    els.keyVisibility.innerHTML = `<svg class="icon"><use href="#i-${showing ? "eye" : "eye-off"}"/></svg>`;
    els.keyVisibility.setAttribute("aria-label", showing ? "显示 API Key" : "隐藏 API Key");
  });
  els.testBtn.addEventListener("click", runConnectionTest);
  els.exportAllBtn.addEventListener("click", exportAll);
  els.clearAllBtn.addEventListener("click", clearEverything);

  els.noteList.addEventListener("click", (event) => {
    const del = event.target.closest("[data-delete]");
    if (del) {
      event.stopPropagation();
      deleteNote(del.dataset.delete);
      return;
    }
    const item = event.target.closest(".note-item");
    if (item) selectNote(item.dataset.id);
  });
  els.noteList.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const item = event.target.closest(".note-item");
    if (!item || event.target.closest("button")) return;
    event.preventDefault();
    selectNote(item.dataset.id);
  });
  els.newNoteBtn.addEventListener("click", newNote);
  els.searchInput.addEventListener("input", () => {
    ui.search = els.searchInput.value;
    renderNotes();
  });

  document.addEventListener("keydown", handleGlobalKeys);
}

function handleGlobalKeys(event) {
  if (els.settingsDialog.open || els.confirmDialog.open) return;
  const target = event.target;
  const typing =
    target instanceof HTMLElement &&
    (target.matches("input, textarea, select") || target.isContentEditable);
  const mod = event.metaKey || event.ctrlKey;

  if (event.key === "Escape") {
    closeDrawers();
    return;
  }
  if (mod && event.key.toLowerCase() === "s") {
    event.preventDefault();
    persistNow();
    showToast("已保存到本机");
    return;
  }
  if (mod && event.key === "Enter") {
    event.preventDefault();
    runAnalysis({ manual: true });
    return;
  }
  if (typing) return;

  const note = activeNote();
  if (mod && event.key.toLowerCase() === "z") {
    if (note.mode === "ink") {
      event.preventDefault();
      if (event.shiftKey) engine.redo();
      else engine.undo();
    }
    return;
  }
  if (note.mode === "ink" && !mod && !event.altKey) {
    const key = event.key.toLowerCase();
    if (key === "p") setTool("pen");
    if (key === "h") setTool("highlighter");
    if (key === "e") setTool("eraser");
  }
}

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

boot();
