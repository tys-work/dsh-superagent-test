/**
 * A small pressure-aware ink engine built on Pointer Events.
 *
 * Strokes are stored in CSS pixels, so the same data renders on any screen.
 * Committed strokes live on one canvas; the in-progress stroke uses a second
 * canvas so we never repaint the whole page while writing.
 */

import { clamp } from "./util.js";

const MAX_HISTORY = 60;
const HIGHLIGHTER_OPACITY = 0.26;

function cloneStrokes(strokes) {
  return (strokes || []).map((stroke) => ({
    tool: stroke.tool,
    color: stroke.color,
    width: stroke.width,
    points: stroke.points.map((point) => [point[0], point[1], point[2]]),
  }));
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export class InkEngine {
  constructor({ baseCanvas, liveCanvas, container, onChange, onHistory, onEmptyChange }) {
    this.baseCanvas = baseCanvas;
    this.liveCanvas = liveCanvas;
    this.container = container;
    this.baseCtx = baseCanvas.getContext("2d");
    this.liveCtx = liveCanvas.getContext("2d");
    this.onChange = onChange || (() => {});
    this.onHistory = onHistory || (() => {});
    this.onEmptyChange = onEmptyChange || (() => {});

    this.strokes = [];
    this.undoStack = [];
    this.redoStack = [];
    this.tool = "pen";
    this.color = "#2a2620";
    this.width = 3.4;
    this.lastPenAt = 0;

    this.cssWidth = 0;
    this.cssHeight = 0;
    this.dpr = 1;
    this.activeStroke = null;
    this.activeBefore = null;
    this.erasing = false;
    this.erasedSinceDown = false;
    this.eraseBefore = null;
    this.pointerId = null;
    this.lastPoint = null;
    this.liveFrame = 0;

    this._onPointerDown = this.handlePointerDown.bind(this);
    this._onPointerMove = this.handlePointerMove.bind(this);
    this._onPointerUp = this.handlePointerUp.bind(this);
    this._onPointerCancel = this.handlePointerCancel.bind(this);

    liveCanvas.addEventListener("pointerdown", this._onPointerDown);
    liveCanvas.addEventListener("pointermove", this._onPointerMove, { passive: false });
    liveCanvas.addEventListener("pointerup", this._onPointerUp);
    liveCanvas.addEventListener("pointercancel", this._onPointerCancel);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.updateCursor();
  }

  get isEmpty() {
    return this.strokes.length === 0;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  setTool(tool) {
    if (!["pen", "highlighter", "eraser"].includes(tool)) return;
    this.tool = tool;
    this.updateCursor();
  }

  setColor(color) {
    if (typeof color === "string" && color) this.color = color;
  }

  setWidth(width) {
    const value = Number(width);
    if (Number.isFinite(value) && value > 0) this.width = value;
  }

  setStrokes(strokes) {
    this.strokes = cloneStrokes(strokes);
    this.undoStack = [];
    this.redoStack = [];
    this.activeStroke = null;
    this.erasing = false;
    this.redraw();
    this.emitHistory();
    this.emitEmpty();
    this.onEmptyChange(this.isEmpty);
  }

  resize() {
    if (!this.container.isConnected) return;
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2.5);
    if (width === this.cssWidth && height === this.cssHeight && dpr === this.dpr) return;

    this.cssWidth = width;
    this.cssHeight = height;
    this.dpr = dpr;
    for (const canvas of [this.baseCanvas, this.liveCanvas]) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    this.setupContext(this.baseCtx);
    this.setupContext(this.liveCtx);
    this.redraw();
    if (this.activeStroke) this.scheduleLiveRedraw();
  }

  setupContext(ctx) {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  clearCanvas(ctx) {
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
    ctx.restore();
  }

  redraw() {
    this.clearCanvas(this.baseCtx);
    for (const stroke of this.strokes) this.paintStroke(this.baseCtx, stroke);
    this.clearCanvas(this.liveCtx);
    if (this.activeStroke) this.paintStroke(this.liveCtx, this.activeStroke);
  }

  paintStroke(ctx, stroke) {
    const points = stroke.points;
    if (!points.length) return;
    const isHighlighter = stroke.tool === "highlighter";
    const baseWidth = stroke.width;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.globalAlpha = isHighlighter ? HIGHLIGHTER_OPACITY : 1;

    if (points.length === 1) {
      const [x, y, pressure] = points[0];
      const radius = isHighlighter
        ? baseWidth * 2
        : (baseWidth * (0.55 + 0.9 * pressure)) / 2;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.6, radius), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    // A highlighter is one even, translucent sweep; drawing it as separate
    // segments would make the alpha stack up at every joint.
    if (isHighlighter) {
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length - 1; i += 1) {
        const midX = (points[i][0] + points[i + 1][0]) / 2;
        const midY = (points[i][1] + points[i + 1][1]) / 2;
        ctx.quadraticCurveTo(points[i][0], points[i][1], midX, midY);
      }
      const last = points[points.length - 1];
      ctx.lineTo(last[0], last[1]);
      ctx.lineWidth = baseWidth * 4;
      ctx.stroke();
      ctx.restore();
      return;
    }

    const widthAt = (index) => {
      if (isHighlighter) return baseWidth * 4;
      const pressure = points[index]?.[2] ?? 0.5;
      return Math.max(0.6, baseWidth * (0.55 + 0.9 * pressure));
    };

    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1];
      const current = points[i];
      const next = points[i + 1];
      const startX = i === 1 ? prev[0] : (points[i - 2][0] + prev[0]) / 2;
      const startY = i === 1 ? prev[1] : (points[i - 2][1] + prev[1]) / 2;
      const endX = next ? (current[0] + next[0]) / 2 : current[0];
      const endY = next ? (current[1] + next[1]) / 2 : current[1];
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      if (next) {
        ctx.quadraticCurveTo(current[0], current[1], endX, endY);
      } else {
        ctx.lineTo(endX, endY);
      }
      ctx.lineWidth = widthAt(i);
      ctx.stroke();
    }
    ctx.restore();
  }

  emitHistory() {
    this.onHistory({ canUndo: this.canUndo, canRedo: this.canRedo });
  }

  emitEmpty() {
    this.onEmptyChange(this.isEmpty);
  }

  emitChange() {
    this.onChange(this.strokes);
    this.emitHistory();
    this.emitEmpty();
  }

  scheduleLiveRedraw() {
    if (this.liveFrame) return;
    this.liveFrame = requestAnimationFrame(() => {
      this.liveFrame = 0;
      this.clearCanvas(this.liveCtx);
      if (this.activeStroke) this.paintStroke(this.liveCtx, this.activeStroke);
    });
  }

  toPoint(event) {
    const rect = this.liveCanvas.getBoundingClientRect();
    const x = clamp(event.clientX - rect.left, 0, this.cssWidth);
    const y = clamp(event.clientY - rect.top, 0, this.cssHeight);
    const rawPressure = event.pointerType === "pen" ? event.pressure : 0.5;
    const pressure = Number.isFinite(rawPressure) && rawPressure > 0 ? rawPressure : 0.5;
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(pressure * 100) / 100];
  }

  handlePointerDown(event) {
    if (!event.isPrimary) return;
    if (event.pointerType === "pen") this.lastPenAt = Date.now();
    if (event.pointerType === "touch" && Date.now() - this.lastPenAt < 1500) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (this.pointerId != null) return;

    event.preventDefault();
    this.pointerId = event.pointerId;
    this.liveCanvas.setPointerCapture(event.pointerId);

    if (this.tool === "eraser") {
      this.erasing = true;
      this.eraseBefore = this.strokes.slice();
      this.erasedSinceDown = false;
      this.eraseAt(this.toPoint(event));
      return;
    }

    const point = this.toPoint(event);
    this.activeBefore = this.strokes.slice();
    this.activeStroke = {
      tool: this.tool,
      color: this.color,
      width: this.width,
      points: [point],
    };
    this.lastPoint = point;
    this.clearCanvas(this.liveCtx);
    this.paintStroke(this.liveCtx, this.activeStroke);
    this.emitEmpty();
  }

  handlePointerMove(event) {
    if (event.pointerId !== this.pointerId) return;
    if (event.pointerType === "pen") this.lastPenAt = Date.now();
    event.preventDefault();

    if (this.erasing) {
      this.eraseAt(this.toPoint(event));
      return;
    }
    if (!this.activeStroke) return;

    const coalesced =
      typeof event.getCoalescedEvents === "function" && event.pointerType === "pen"
        ? event.getCoalescedEvents()
        : [];
    const events = coalesced.length ? coalesced : [event];
    for (const item of events) {
      const point = this.toPoint(item);
      const last = this.lastPoint;
      if (last && Math.hypot(point[0] - last[0], point[1] - last[1]) < 0.65) continue;
      if (last) point[2] = Math.round((last[2] * 0.3 + point[2] * 0.7) * 100) / 100;
      this.activeStroke.points.push(point);
      this.lastPoint = point;
    }
    this.scheduleLiveRedraw();
  }

  handlePointerUp(event) {
    if (event.pointerId !== this.pointerId) return;
    if (event.pointerType === "pen") this.lastPenAt = Date.now();
    this.finishPointer();
  }

  handlePointerCancel(event) {
    if (event.pointerId !== this.pointerId) return;
    if (this.erasing) {
      this.finishPointer();
      return;
    }
    this.activeStroke = null;
    this.erasing = false;
    this.pointerId = null;
    this.lastPoint = null;
    this.clearCanvas(this.liveCtx);
    this.emitEmpty();
  }

  finishPointer() {
    if (this.erasing) {
      const changed = this.erasedSinceDown;
      this.erasing = false;
      this.erasedSinceDown = false;
      if (changed && this.eraseBefore) {
        this.undoStack.push(this.eraseBefore);
        if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
        this.redoStack = [];
        this.emitChange();
      }
      this.eraseBefore = null;
    } else if (this.activeStroke) {
      const stroke = this.activeStroke;
      this.activeStroke = null;
      if (this.activeBefore) {
        this.undoStack.push(this.activeBefore);
        if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
        this.redoStack = [];
      }
      this.strokes = [...this.strokes, stroke];
      this.paintStroke(this.baseCtx, stroke);
      this.clearCanvas(this.liveCtx);
      this.emitChange();
    }

    if (this.pointerId != null && this.liveCanvas.hasPointerCapture(this.pointerId)) {
      this.liveCanvas.releasePointerCapture(this.pointerId);
    }
    this.pointerId = null;
    this.lastPoint = null;
    this.activeBefore = null;
  }

  eraseAt(point) {
    const [x, y] = point;
    let removed = false;
    for (let i = this.strokes.length - 1; i >= 0; i -= 1) {
      const stroke = this.strokes[i];
      const threshold = (stroke.tool === "highlighter" ? stroke.width * 2 : stroke.width / 2) + 9;
      let hit = false;
      if (stroke.points.length === 1) {
        hit = Math.hypot(x - stroke.points[0][0], y - stroke.points[0][1]) <= threshold;
      } else {
        for (let j = 1; j < stroke.points.length; j += 1) {
          const a = stroke.points[j - 1];
          const b = stroke.points[j];
          if (distanceToSegment(x, y, a[0], a[1], b[0], b[1]) <= threshold) {
            hit = true;
            break;
          }
        }
      }
      if (hit) {
        this.strokes.splice(i, 1);
        removed = true;
      }
    }
    if (removed) {
      this.erasedSinceDown = true;
      this.redraw();
      this.emitEmpty();
    }
  }

  undo() {
    if (!this.canUndo) return false;
    this.redoStack.push(this.strokes.slice());
    this.strokes = this.undoStack.pop();
    this.redraw();
    this.emitChange();
    return true;
  }

  redo() {
    if (!this.canRedo) return false;
    this.undoStack.push(this.strokes.slice());
    this.strokes = this.redoStack.pop();
    this.redraw();
    this.emitChange();
    return true;
  }

  clear() {
    if (!this.strokes.length) return false;
    this.undoStack.push(this.strokes.slice());
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.strokes = [];
    this.redraw();
    this.emitChange();
    return true;
  }

  updateCursor() {
    if (this.tool !== "eraser") {
      this.liveCanvas.style.cursor = "crosshair";
      return;
    }
    const svg =
      "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'>" +
      "<circle cx='12' cy='12' r='8' fill='none' stroke='#b9481f' stroke-width='1.4' opacity='.8'/>" +
      "</svg>";
    this.liveCanvas.style.cursor = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(
      svg,
    )}") 12 12, crosshair`;
  }

  /**
   * Render the page (without the dot grid) to an image.
   * @returns {string} data URL
   */
  exportDataUrl({ maxDim = 1280, type = "image/jpeg", quality = 0.84, background = "#ffffff" } = {}) {
    const width = this.cssWidth || 1;
    const height = this.cssHeight || 1;
    const scale = Math.min(2, Math.max(0.1, maxDim / Math.max(width, height)));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    for (const stroke of this.strokes) this.paintStroke(ctx, stroke);
    return canvas.toDataURL(type, quality);
  }

  destroy() {
    this.resizeObserver.disconnect();
    this.liveCanvas.removeEventListener("pointerdown", this._onPointerDown);
    this.liveCanvas.removeEventListener("pointermove", this._onPointerMove);
    this.liveCanvas.removeEventListener("pointerup", this._onPointerUp);
    this.liveCanvas.removeEventListener("pointercancel", this._onPointerCancel);
    if (this.liveFrame) cancelAnimationFrame(this.liveFrame);
  }
}
