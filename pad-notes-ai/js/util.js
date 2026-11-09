/**
 * Small, dependency-free helpers shared by the app.
 */

/** Debounce a function by `wait` milliseconds. */
export function debounce(fn, wait = 200) {
  let timer = 0;
  function wrapped(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  }
  wrapped.cancel = () => clearTimeout(timer);
  wrapped.flush = (...args) => {
    clearTimeout(timer);
    fn.apply(this, args);
  };
  return wrapped;
}

/** Throttle to at most one call per animation frame. */
export function rafThrottle(fn) {
  let queued = false;
  let lastArgs = [];
  return function schedule(...args) {
    lastArgs = args;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn(...lastArgs);
    });
  };
}

/** Unique-enough id for local notes. */
export function uid(prefix = "n") {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Stable hash for detecting note changes. */
export function hashString(value) {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

export function truncate(value, max) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function formatClock(date = new Date()) {
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** "刚刚", "12 分钟前", "今天 14:30", "昨天 09:12", "3 天前", "2026/1/8". */
export function formatRelative(timestamp) {
  const then = new Date(timestamp);
  if (Number.isNaN(then.getTime())) return "";
  const now = new Date();
  const diff = now.getTime() - then.getTime();
  if (diff < 60 * 1000) return "刚刚";
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfThen = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime();
  const dayDiff = Math.round((startOfToday - startOfThen) / 86400000);
  if (dayDiff === 0) return `今天 ${formatClock(then)}`;
  if (dayDiff === 1) return `昨天 ${formatClock(then)}`;
  if (dayDiff < 7) return `${dayDiff} 天前`;
  if (then.getFullYear() === now.getFullYear()) {
    return `${then.getMonth() + 1} 月 ${then.getDate()} 日`;
  }
  return `${then.getFullYear()}/${then.getMonth() + 1}/${then.getDate()}`;
}

/** Grow a textarea to fit its content, capped by CSS max-height when present. */
export function autoGrow(textarea) {
  if (!textarea) return;
  textarea.style.height = "auto";
  const max = Number.parseFloat(getComputedStyle(textarea).maxHeight);
  const height = Number.isFinite(max) ? Math.min(textarea.scrollHeight, max) : textarea.scrollHeight;
  textarea.style.height = `${height}px`;
  textarea.style.overflowY = textarea.scrollHeight > height + 2 ? "auto" : "hidden";
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Copy text, falling back to a temporary textarea on older browsers. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.append(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFilename(name, fallback = "笔记") {
  const cleaned = String(name || "")
    .replace(/[\\/:*?"<>|\n\r\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return cleaned || fallback;
}
