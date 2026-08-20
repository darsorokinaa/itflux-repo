(function () {
  "use strict";

  var config = window.__LESSON_DRAWING__ || {};
  var slug = config.slug || "lesson";
  var storagePrefix = "lesson-slide-draw-v2:" + slug + ":";

  var COLORS = ["#1e293b", "#4f46e5", "#0d9488", "#dc2626", "#ca8a04"];
  var WIDTHS = [2.5, 4.5, 7.5];

  function newStrokeId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "s-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  function sanitizeStrokes(raw) {
    if (!Array.isArray(raw)) return [];
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var s = raw[i];
      if (!s || typeof s !== "object") continue;
      var tool = s.tool === "shape" ? "shape" : s.tool === "pencil" ? "pencil" : null;
      if (!tool) continue;
      var stroke = {
        id: typeof s.id === "string" ? s.id : newStrokeId(),
        tool: tool,
        color: typeof s.color === "string" ? s.color : "#1e293b",
        size: typeof s.size === "number" && s.size > 0 ? s.size : 3,
        points: Array.isArray(s.points) ? s.points.slice() : [],
      };
      if (tool === "pencil") {
        if (stroke.points.length === 0) continue;
        out.push(stroke);
      } else {
        stroke.shape = ["line", "rect", "circle", "arrow"].indexOf(s.shape) >= 0 ? s.shape : null;
        if (!stroke.shape || !s.start || !s.end) continue;
        stroke.start = { x: s.start.x, y: s.start.y };
        stroke.end = { x: s.end.x, y: s.end.y };
        out.push(stroke);
      }
    }
    return out;
  }

  function distPointToSegment(px, py, x0, y0, x1, y1) {
    var dx = x1 - x0;
    var dy = y1 - y0;
    var len2 = dx * dx + dy * dy;
    if (len2 < 1e-6) return Math.hypot(px - x0, py - y0);
    var t = ((px - x0) * dx + (py - y0) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    var qx = x0 + t * dx;
    var qy = y0 + t * dy;
    return Math.hypot(px - qx, py - qy);
  }

  function canvasScale(canvas) {
    if (!canvas) return 1;
    var rect = canvas.getBoundingClientRect();
    return canvas.width / Math.max(rect.width, 1e-6);
  }

  function padFor(stroke, scale) {
    var s = scale && isFinite(scale) && scale > 0 ? scale : 1;
    return Math.max(28 * s, (stroke.size + 22) * s);
  }

  function hitPencil(stroke, x, y, scale) {
    var pad = padFor(stroke, scale);
    var pts = stroke.points || [];
    for (var i = 0; i < pts.length; i++) {
      if (Math.hypot(x - pts[i].x, y - pts[i].y) <= pad) return true;
    }
    for (var j = 0; j < pts.length - 1; j++) {
      if (distPointToSegment(x, y, pts[j].x, pts[j].y, pts[j + 1].x, pts[j + 1].y) <= pad) return true;
    }
    return false;
  }

  function hitRectStroke(stroke, x, y, scale) {
    var pad = padFor(stroke, scale);
    var start = stroke.start;
    var end = stroke.end;
    var x0 = Math.min(start.x, end.x) - pad;
    var x1 = Math.max(start.x, end.x) + pad;
    var y0 = Math.min(start.y, end.y) - pad;
    var y1 = Math.max(start.y, end.y) + pad;
    return x >= x0 && x <= x1 && y >= y0 && y <= y1;
  }

  function hitCircleStroke(stroke, x, y, scale) {
    var pad = padFor(stroke, scale);
    var cx = (stroke.start.x + stroke.end.x) / 2;
    var cy = (stroke.start.y + stroke.end.y) / 2;
    var r = Math.min(Math.abs(stroke.end.x - stroke.start.x), Math.abs(stroke.end.y - stroke.start.y)) / 2;
    return Math.hypot(x - cx, y - cy) <= r + pad;
  }

  function hitLineArrowStroke(stroke, x, y, scale) {
    var pad = padFor(stroke, scale);
    return distPointToSegment(x, y, stroke.start.x, stroke.start.y, stroke.end.x, stroke.end.y) <= pad;
  }

  function findHitStroke(strokes, x, y, scale) {
    for (var i = strokes.length - 1; i >= 0; i--) {
      var s = strokes[i];
      if (s.tool === "pencil" && hitPencil(s, x, y, scale)) return s;
      if (s.tool === "shape" && s.shape === "rect" && hitRectStroke(s, x, y, scale)) return s;
      if (s.tool === "shape" && s.shape === "circle" && hitCircleStroke(s, x, y, scale)) return s;
      if (s.tool === "shape" && (s.shape === "line" || s.shape === "arrow") && hitLineArrowStroke(s, x, y, scale)) return s;
    }
    return null;
  }

  function drawPencilPath(ctx, points, size, color) {
    if (points.length < 2) {
      if (points.length === 1) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(points[0].x, points[0].y, size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (var i = 1; i < points.length; i++) {
      var p0 = points[i - 1];
      var p1 = points[i];
      ctx.quadraticCurveTo(p0.x, p0.y, (p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
    }
    var last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }

  function drawArrowHead(ctx, x0, y0, x1, y1, sz) {
    var dx = x1 - x0;
    var dy = y1 - y0;
    var angle = Math.atan2(dy, dx);
    var headLen = Math.max(12, sz * 3);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - headLen * Math.cos(angle - Math.PI / 6), y1 - headLen * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - headLen * Math.cos(angle + Math.PI / 6), y1 - headLen * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  }

  function drawStroke(ctx, stroke, alpha) {
    alpha = alpha == null ? 1 : alpha;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (stroke.tool === "pencil") {
      drawPencilPath(ctx, stroke.points, stroke.size, stroke.color);
      ctx.restore();
      return;
    }
    if (stroke.tool === "shape" && stroke.start && stroke.end) {
      var x0 = stroke.start.x;
      var y0 = stroke.start.y;
      var x1 = stroke.end.x;
      var y1 = stroke.end.y;
      if (stroke.shape === "line") {
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      } else if (stroke.shape === "arrow") {
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        drawArrowHead(ctx, x0, y0, x1, y1, stroke.size);
      } else if (stroke.shape === "rect") {
        ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      } else if (stroke.shape === "circle") {
        var cx = (x0 + x1) / 2;
        var cy = (y0 + y1) / 2;
        var r = Math.min(Math.abs(x1 - x0), Math.abs(y1 - y0)) / 2;
        if (r > 0.5) {
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  function redrawAll(ctx, canvas, strokes, draft, hoveredId) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (var i = 0; i < strokes.length; i++) {
      drawStroke(ctx, strokes[i], strokes[i].id === hoveredId ? 0.4 : 1);
    }
    if (draft) drawStroke(ctx, draft, 0.45);
  }

  function loadStrokes(index) {
    try {
      var raw = localStorage.getItem(storagePrefix + index);
      return raw ? sanitizeStrokes(JSON.parse(raw)) : [];
    } catch (e) {
      return [];
    }
  }

  function saveStrokes(index, strokes) {
    try {
      localStorage.setItem(storagePrefix + index, JSON.stringify(strokes));
    } catch (e) {
      /* ignore */
    }
  }

  function clientToCanvas(canvas, clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    var sx = canvas.width / Math.max(rect.width, 1e-6);
    var sy = canvas.height / Math.max(rect.height, 1e-6);
    return {
      x: (clientX - rect.left) * sx,
      y: (clientY - rect.top) * sy,
    };
  }

  function svgFromHtml(html) {
    var wrap = document.createElement("div");
    wrap.innerHTML = html.trim();
    return wrap.firstChild;
  }

  var ICONS = {
    cursor:
      '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 2 L3.5 11.5 L6.2 9.2 L8 13.5 L9.8 12.7 L8 8.5 L11.5 8.5 Z"/></svg>',
    pencil:
      '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 2.5 L13.5 5 L5.5 13 L2.5 13.5 L3 10.5 Z"/><line x1="9" y1="4.5" x2="11.5" y2="7"/></svg>',
    eraser:
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>',
    shapes:
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z"/><rect x="3" y="14" width="7" height="7" rx="1"/><circle cx="17.5" cy="17.5" r="3.5"/></svg>',
    undo:
      '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 7 C2.5 4 5 2 8 2 C11.5 2 14 4.5 14 8 C14 11.5 11.5 14 8 14"/><polyline points="2.5 3.5 2.5 7 6 7"/></svg>',
    redo:
      '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 7 C13.5 4 11 2 8 2 C4.5 2 2 4.5 2 8 C2 11.5 4.5 14 8 14"/><polyline points="13.5 3.5 13.5 7 10 7"/></svg>',
    deleteAll:
      '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="#EF4444" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="2" y1="4.5" x2="14" y2="4.5"/><path d="M5.5 4.5 V3 C5.5 2.4 6 2 6.5 2 H9.5 C10 2 10.5 2.4 10.5 3 V4.5"/><path d="M4 4.5 L4.5 13 C4.5 13.6 5 14 5.5 14 H10.5 C11 14 11.5 13.6 11.5 13 L12 4.5"/><line x1="7" y1="7" x2="7" y2="11.5"/><line x1="9.5" y1="7" x2="9.5" y2="11.5"/></svg>',
    collapse:
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.65" aria-hidden="true"><path d="M18 15l-6-6-6 6" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 9v12" stroke-linecap="round"/></svg>',
    fabPencil:
      '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.65" aria-hidden="true"><path d="M12 19h9" stroke-linecap="round"/><path d="M14.83 4.17 19 8.34 8.34 19H4v-4.34L14.83 4.17z" stroke-linejoin="round"/><path d="M16.5 2.5l5 5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    grip:
      '<svg width="14" height="18" viewBox="0 0 14 18" fill="currentColor" aria-hidden="true"><circle cx="4" cy="3" r="1.4"/><circle cx="10" cy="3" r="1.4"/><circle cx="4" cy="9" r="1.4"/><circle cx="10" cy="9" r="1.4"/><circle cx="4" cy="15" r="1.4"/><circle cx="10" cy="15" r="1.4"/></svg>',
  };

  function makeToolBtn(iconKey, titleText) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toolbar-row1__btn";
    btn.title = titleText;
    btn.setAttribute("aria-label", titleText);
    btn.appendChild(svgFromHtml(ICONS[iconKey]));
    return btn;
  }

  function dotSizeForWidth(w) {
    return Math.max(4, Math.round((6 + w) / 2)) + "px";
  }

  function init() {
    var stale = document.querySelectorAll(".lesson-draw-root:not([data-lesson-draw='v3'])");
    for (var si = 0; si < stale.length; si++) stale[si].parentNode && stale[si].parentNode.removeChild(stale[si]);
    if (document.querySelector(".lesson-draw-root[data-lesson-draw='v3']")) return;
    if (window.matchMedia && window.matchMedia("(max-width: 479px)").matches) return;

    var slides = Array.prototype.slice.call(document.querySelectorAll(".deck .slide"));
    if (!slides.length) slides = Array.prototype.slice.call(document.querySelectorAll(".reveal .slides > section"));
    if (!slides.length) slides = Array.prototype.slice.call(document.querySelectorAll(".slide"));
    if (!slides.length) {
      var fallbackHost = document.querySelector(".deck, .reveal, .slides, main, .page");
      slides = [fallbackHost || document.body];
    }
    if (!slides.length) return;

    var state = {
      boardOpen: false,
      tool: null,
      shapeKind: "line",
      strokeColor: COLORS[0],
      strokeWidth: WIDTHS[1],
      activeIndex: 0,
      hoveredId: null,
      draft: null,
      redoStack: [],
      drawing: false,
    };

    var slideStates = slides.map(function (slide, index) {
      slide.classList.add("lesson-draw-host");
      var layer = document.createElement("div");
      layer.className = "lesson-draw-layer";
      var canvas = document.createElement("canvas");
      canvas.className = "lesson-draw-canvas";
      canvas.setAttribute("aria-hidden", "true");
      layer.appendChild(canvas);
      return {
        index: index,
        slide: slide,
        layer: layer,
        canvas: canvas,
        ctx: null,
        strokes: loadStrokes(index),
      };
    });

    var root = document.createElement("div");
    root.className = "lesson-draw-root";

    var chrome = document.createElement("div");
    chrome.className = "lesson-draw-chrome";

    var panelWrap = document.createElement("div");
    panelWrap.className = "lesson-draw-panel-wrap";

    var panel = document.createElement("div");
    panel.className = "exam-drawing-panel";
    panel.setAttribute("role", "toolbar");
    panel.setAttribute("aria-label", "Черновик к слайду");

    var row1 = document.createElement("div");
    row1.className = "exam-drawing-panel__row";

    var toolsMain = document.createElement("div");
    toolsMain.className = "exam-drawing-panel__tools-main";

    var toolbar = document.createElement("div");
    toolbar.className = "toolbar-row1";

    var btnCursor = makeToolBtn("cursor", "Курсор (V) — прокрутка и выделение текста");
    var btnPencil = makeToolBtn("pencil", "Карандаш (P)");
    var btnEraser = makeToolBtn("eraser", "Ластик (E)");

    var shapesWrap = document.createElement("div");
    shapesWrap.className = "exam-drawing-panel__shapes-wrap";
    var btnShapes = makeToolBtn("shapes", "Фигуры (S)");
    btnShapes.setAttribute("aria-haspopup", "true");

    var popover = document.createElement("div");
    popover.className = "exam-drawing-panel__popover";
    popover.setAttribute("role", "menu");
    var popTitle = document.createElement("div");
    popTitle.className = "exam-drawing-panel__popover-title";
    popTitle.textContent = "Фигуры";
    popover.appendChild(popTitle);

    var shapePicks = {};
    ["line", "rect", "circle", "arrow"].forEach(function (kind) {
      var pick = document.createElement("button");
      pick.type = "button";
      pick.className = "exam-drawing-panel__shape-pick";
      pick.dataset.shape = kind;
      pick.textContent =
        kind === "line"
          ? "Линия (L)"
          : kind === "rect"
            ? "Прямоугольник (R)"
            : kind === "circle"
              ? "Окружность (O)"
              : "Стрелка (A)";
      pick.addEventListener("click", function () {
        state.shapeKind = kind;
        state.tool = "shape";
        popover.classList.remove("is-open");
        syncUi();
      });
      shapePicks[kind] = pick;
      popover.appendChild(pick);
    });
    shapesWrap.appendChild(btnShapes);
    shapesWrap.appendChild(popover);

    btnShapes.addEventListener("click", function () {
      state.tool = "shape";
      popover.classList.toggle("is-open");
      syncUi();
    });

    var sep1 = document.createElement("div");
    sep1.className = "toolbar-row1__sep";
    sep1.setAttribute("aria-hidden", "true");

    var btnUndo = makeToolBtn("undo", "Отменить (Ctrl+Z)");
    var btnRedo = makeToolBtn("redo", "Вернуть (Ctrl+Shift+Z)");

    var sep2 = document.createElement("div");
    sep2.className = "toolbar-row1__sep";
    sep2.setAttribute("aria-hidden", "true");

    var btnClear = makeToolBtn("deleteAll", "Стереть всё");
    btnClear.className = "toolbar-row1__btn toolbar-row1__btn--danger";

    var dragHandle = document.createElement("button");
    dragHandle.type = "button";
    dragHandle.className = "lesson-draw-handle";
    dragHandle.title = "Перетащить панель";
    dragHandle.setAttribute("aria-label", "Перетащить панель");
    dragHandle.appendChild(svgFromHtml(ICONS.grip));

    toolbar.appendChild(dragHandle);
    toolbar.appendChild(btnCursor);
    toolbar.appendChild(btnPencil);
    toolbar.appendChild(btnEraser);
    toolbar.appendChild(shapesWrap);
    toolbar.appendChild(sep1);
    toolbar.appendChild(btnUndo);
    toolbar.appendChild(btnRedo);
    toolbar.appendChild(sep2);
    toolbar.appendChild(btnClear);
    toolsMain.appendChild(toolbar);
    row1.appendChild(toolsMain);

    var btnClose = document.createElement("button");
    btnClose.type = "button";
    btnClose.className = "exam-drawing-panel__icon-btn exam-drawing-panel__icon-btn--close";
    btnClose.title = "Свернуть панель (рисунок сохраняется)";
    btnClose.setAttribute("aria-label", "Свернуть панель");
    btnClose.appendChild(svgFromHtml(ICONS.collapse));
    row1.appendChild(btnClose);

    var row2 = document.createElement("div");
    row2.className = "exam-drawing-panel__row exam-drawing-panel__row--secondary";

    var widthLabel = document.createElement("span");
    widthLabel.className = "exam-drawing-panel__label";
    widthLabel.textContent = "Толщина";
    row2.appendChild(widthLabel);

    var widths = document.createElement("div");
    widths.className = "exam-drawing-panel__widths";
    WIDTHS.forEach(function (w) {
      var dot = document.createElement("button");
      dot.type = "button";
      dot.className = "exam-drawing-panel__width-dot";
      dot.dataset.width = String(w);
      dot.style.setProperty("--dot-size", dotSizeForWidth(w));
      dot.title = "Толщина " + w;
      dot.setAttribute("aria-label", "Толщина линии " + w);
      dot.addEventListener("click", function () {
        state.strokeWidth = w;
        syncUi();
      });
      widths.appendChild(dot);
    });
    row2.appendChild(widths);

    var colorLabel = document.createElement("span");
    colorLabel.className = "exam-drawing-panel__label";
    colorLabel.textContent = "Цвет";
    row2.appendChild(colorLabel);

    var colors = document.createElement("div");
    colors.className = "exam-drawing-panel__colors";
    COLORS.forEach(function (color) {
      var sw = document.createElement("button");
      sw.type = "button";
      sw.className = "exam-drawing-panel__swatch";
      sw.style.setProperty("--swatch", color);
      sw.title = color;
      sw.setAttribute("aria-label", color);
      sw.addEventListener("click", function () {
        state.strokeColor = color;
        state.tool = "pencil";
        syncUi();
      });
      colors.appendChild(sw);
    });
    row2.appendChild(colors);

    panel.appendChild(row1);
    panel.appendChild(row2);
    panelWrap.appendChild(panel);

    var toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "lesson-draw-fab";
    toggleBtn.title = "Черновик — перетащите, чтобы переместить";
    toggleBtn.setAttribute("aria-label", "Черновик");
    toggleBtn.appendChild(svgFromHtml(ICONS.fabPencil));

    chrome.appendChild(panelWrap);
    chrome.appendChild(toggleBtn);
    slideStates.forEach(function (entry) {
      root.appendChild(entry.layer);
    });
    root.appendChild(chrome);
    root.setAttribute("data-lesson-draw", "v3");
    root.tabIndex = -1;
    document.body.appendChild(root);

    function activeSlide() {
      return slideStates[state.activeIndex] || slideStates[0];
    }

    function slideVisibleArea(el) {
      if (!el || el === document.body || el === document.documentElement) {
        return window.innerWidth * window.innerHeight;
      }
      var r = el.getBoundingClientRect();
      var w = Math.max(0, Math.min(r.right, window.innerWidth) - Math.max(r.left, 0));
      var h = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0));
      return w * h;
    }

    function getActiveIndex() {
      var marked = ["active", "present", "current", "is-active", "is-current", "is-visible"];
      for (var i = 0; i < slideStates.length; i++) {
        var cl = slideStates[i].slide.classList;
        for (var c = 0; c < marked.length; c++) {
          if (cl.contains(marked[c])) return i;
        }
      }
      var best = state.activeIndex;
      var bestArea = 0;
      for (var j = 0; j < slideStates.length; j++) {
        var area = slideVisibleArea(slideStates[j].slide);
        if (area > bestArea) {
          bestArea = area;
          best = j;
        }
      }
      return best;
    }

    function syncLayerBox(entry) {
      var layer = entry.layer;
      layer.style.position = "fixed";
      layer.style.left = "0px";
      layer.style.top = "0px";
      layer.style.width = Math.max(1, window.innerWidth) + "px";
      layer.style.height = Math.max(1, window.innerHeight) + "px";
      layer.style.right = "auto";
      layer.style.bottom = "auto";
      layer.style.margin = "0";
    }

    function fitCanvas(entry) {
      syncLayerBox(entry);
      var canvas = entry.canvas;
      var rect = entry.layer.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      var w = Math.max(1, Math.floor(rect.width * dpr));
      var h = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        entry.ctx = canvas.getContext("2d", { alpha: true });
        if (entry.ctx) {
          entry.ctx.imageSmoothingEnabled = true;
          entry.ctx.imageSmoothingQuality = "high";
        }
      }
      if (entry.ctx) {
        var draft = entry.index === state.activeIndex ? state.draft : null;
        var hovered = entry.index === state.activeIndex ? state.hoveredId : null;
        redrawAll(entry.ctx, canvas, entry.strokes, draft, hovered);
      }
    }

    function persistActive() {
      var entry = activeSlide();
      saveStrokes(entry.index, entry.strokes);
    }

    function syncLayers() {
      slideStates.forEach(function (entry, i) {
        var isActive = i === state.activeIndex;
        var showLayer = isActive && (state.boardOpen || entry.strokes.length > 0);
        entry.layer.style.display = showLayer ? "" : "none";
        entry.layer.classList.toggle("is-visible", showLayer);
        var interactive = state.boardOpen && isActive && state.tool && state.tool !== "cursor";
        entry.layer.classList.toggle("is-interactive", interactive);
        entry.layer.classList.toggle("is-drawing", interactive && state.tool !== "eraser");
        entry.layer.classList.toggle("is-eraser", interactive && state.tool === "eraser");
        entry.canvas.classList.toggle("is-drawing", interactive && state.tool !== "eraser");
        entry.canvas.classList.toggle("is-eraser", interactive && state.tool === "eraser");
        fitCanvas(entry);
      });
    }

    function syncUi() {
      toggleBtn.classList.toggle("is-active", state.boardOpen);
      panelWrap.classList.toggle("is-open", state.boardOpen);
      btnCursor.classList.toggle("is-active", state.tool === "cursor");
      btnPencil.classList.toggle("is-active", state.tool === "pencil");
      btnEraser.classList.toggle("is-active", state.tool === "eraser");
      btnShapes.classList.toggle("is-active", state.tool === "shape");
      btnRedo.disabled = state.redoStack.length === 0;
      Object.keys(shapePicks).forEach(function (kind) {
        shapePicks[kind].classList.toggle("is-active", state.tool === "shape" && state.shapeKind === kind);
      });
      Array.prototype.forEach.call(widths.querySelectorAll(".exam-drawing-panel__width-dot"), function (dot) {
        dot.classList.toggle("is-active", Number(dot.dataset.width) === state.strokeWidth);
      });
      Array.prototype.forEach.call(colors.querySelectorAll(".exam-drawing-panel__swatch"), function (sw) {
        sw.classList.toggle("is-active", sw.title === state.strokeColor);
      });
      syncLayers();
    }

    function onActiveSlideChange() {
      state.activeIndex = getActiveIndex();
      state.draft = null;
      state.hoveredId = null;
      state.drawing = false;
      syncLayers();
    }

    slideStates.forEach(function (entry) {
      new MutationObserver(onActiveSlideChange).observe(entry.slide, {
        attributes: true,
        attributeFilter: ["class"],
      });
      new ResizeObserver(function () {
        fitCanvas(entry);
      }).observe(entry.slide);
    });

    function toggleBoard() {
      state.boardOpen = !state.boardOpen;
      if (state.boardOpen) {
        state.tool = "pencil";
        try {
          root.focus({ preventScroll: true });
        } catch (errFocus) {}
      } else {
        state.tool = null;
        state.draft = null;
        state.redoStack = [];
      }
      syncUi();
    }

    function undoLast() {
      var entry = activeSlide();
      if (!entry.strokes.length) return;
      state.redoStack.push(entry.strokes.pop());
      persistActive();
      syncUi();
    }
    function redoLast() {
      if (!state.redoStack.length) return;
      var entry = activeSlide();
      entry.strokes.push(state.redoStack.pop());
      persistActive();
      syncUi();
    }
    function setTool(tool, shapeKind) {
      state.tool = tool;
      if (shapeKind) state.shapeKind = shapeKind;
      if (tool !== "shape") popover.classList.remove("is-open");
      syncUi();
    }

    btnCursor.addEventListener("click", function () {
      setTool("cursor");
    });
    btnPencil.addEventListener("click", function () {
      setTool("pencil");
    });
    btnEraser.addEventListener("click", function () {
      setTool("eraser");
    });
    btnUndo.addEventListener("click", undoLast);
    btnRedo.addEventListener("click", redoLast);
    btnClear.addEventListener("click", function () {
      if (!window.confirm("Очистить все пометки на этом слайде?")) return;
      var entry = activeSlide();
      entry.strokes = [];
      state.redoStack = [];
      persistActive();
      syncUi();
    });
    btnClose.addEventListener("click", function () {
      state.boardOpen = false;
      state.tool = null;
      state.draft = null;
      syncUi();
    });

    document.addEventListener("pointerdown", function (e) {
      if (!popover.contains(e.target) && e.target !== btnShapes && !btnShapes.contains(e.target)) {
        popover.classList.remove("is-open");
      }
    });

    function eraseAt(entry, x, y) {
      var hit = findHitStroke(entry.strokes, x, y, canvasScale(entry.canvas));
      if (!hit) return false;
      state.redoStack = [];
      entry.strokes = entry.strokes.filter(function (s) {
        return s.id !== hit.id;
      });
      persistActive();
      if (entry.ctx) redrawAll(entry.ctx, entry.canvas, entry.strokes, null, null);
      return true;
    }

    slideStates.forEach(function (entry) {
      var surface = entry.layer;
      surface.addEventListener("pointerdown", function (e) {
        if (!state.boardOpen || entry.index !== state.activeIndex) return;
        if (state.tool === "cursor" || !state.tool) return;
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        var pt = clientToCanvas(entry.canvas, e.clientX, e.clientY);
        if (state.tool === "eraser") {
          eraseAt(entry, pt.x, pt.y);
          state.drawing = true;
          try {
            surface.setPointerCapture(e.pointerId);
          } catch (err) {}
          return;
        }
        if (state.tool === "pencil") {
          state.draft = {
            id: newStrokeId(),
            tool: "pencil",
            color: state.strokeColor,
            size: state.strokeWidth,
            points: [{ x: pt.x, y: pt.y }],
          };
          state.drawing = true;
        } else if (state.tool === "shape") {
          state.draft = {
            id: newStrokeId(),
            tool: "shape",
            shape: state.shapeKind,
            color: state.strokeColor,
            size: state.strokeWidth,
            points: [],
            start: { x: pt.x, y: pt.y },
            end: { x: pt.x, y: pt.y },
          };
          state.drawing = true;
        }
        try {
          surface.setPointerCapture(e.pointerId);
        } catch (err2) {}
        syncUi();
      });

      surface.addEventListener("pointermove", function (e) {
        if (entry.index !== state.activeIndex) return;
        var pt = clientToCanvas(entry.canvas, e.clientX, e.clientY);
        if (state.tool === "eraser" && state.boardOpen) {
          if (state.drawing) {
            e.preventDefault();
            eraseAt(entry, pt.x, pt.y);
          } else if (surface.classList.contains("is-interactive")) {
            var hit = findHitStroke(entry.strokes, pt.x, pt.y, canvasScale(entry.canvas));
            state.hoveredId = hit ? hit.id : null;
            syncLayers();
          }
          return;
        }
        if (!state.drawing || !state.draft) return;
        e.preventDefault();
        if (state.draft.tool === "pencil") {
          var pts = state.draft.points;
          var last = pts[pts.length - 1];
          if (last && Math.hypot(pt.x - last.x, pt.y - last.y) < 2) return;
          state.draft.points = pts.concat([{ x: pt.x, y: pt.y }]);
        } else if (state.draft.tool === "shape") {
          state.draft.end = { x: pt.x, y: pt.y };
        }
        syncLayers();
      });

      function endPointer(e) {
        if (state.tool === "eraser") {
          state.drawing = false;
          state.hoveredId = null;
          try {
            surface.releasePointerCapture(e.pointerId);
          } catch (err) {}
          syncUi();
          return;
        }
        if (!state.drawing) return;
        state.drawing = false;
        try {
          surface.releasePointerCapture(e.pointerId);
        } catch (err2) {}
        var draft = state.draft;
        state.draft = null;
        if (!draft) return;
        if (draft.tool === "pencil" && draft.points.length) {
          state.redoStack = [];
          entry.strokes = entry.strokes.concat([draft]);
          persistActive();
        } else if (draft.tool === "shape" && draft.start && draft.end) {
          if (Math.abs(draft.end.x - draft.start.x) > 2 || Math.abs(draft.end.y - draft.start.y) > 2) {
            state.redoStack = [];
            entry.strokes = entry.strokes.concat([draft]);
            persistActive();
          }
        }
        syncUi();
      }

      surface.addEventListener("pointerup", endPointer);
      surface.addEventListener("pointercancel", endPointer);

      function blockTouch(e) {
        if (!state.boardOpen || entry.index !== state.activeIndex) return;
        if (state.tool === "cursor" || !state.tool) return;
        e.preventDefault();
      }
      surface.addEventListener("touchstart", blockTouch, { passive: false });
      surface.addEventListener("touchmove", blockTouch, { passive: false });
    });

    function isEditableTarget(el) {
      if (!el || el === document.body) return false;
      var tag = (el.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return true;
      if (el.isContentEditable) return true;
      return false;
    }

    function ensureOpen() {
      if (state.boardOpen) return;
      state.boardOpen = true;
      try {
        root.focus({ preventScroll: true });
      } catch (errOpen) {}
    }

    window.addEventListener(
      "keydown",
      function (e) {
        if (isEditableTarget(e.target)) return;
        var meta = e.ctrlKey || e.metaKey;
        var code = e.code || "";
        if (meta && (code === "KeyZ" || e.key === "z" || e.key === "Z")) {
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey) redoLast();
          else undoLast();
          return;
        }
        if (meta && (code === "KeyY" || e.key === "y" || e.key === "Y")) {
          e.preventDefault();
          e.stopPropagation();
          redoLast();
          return;
        }
        if (meta || e.altKey) return;
        if (code === "Escape" || e.key === "Escape") {
          if (!state.boardOpen) return;
          e.preventDefault();
          e.stopPropagation();
          if (popover.classList.contains("is-open")) {
            popover.classList.remove("is-open");
            return;
          }
          setTool("cursor");
          return;
        }
        var handled = true;
        if (code === "KeyV") {
          ensureOpen();
          setTool("cursor");
        } else if (code === "KeyP") {
          ensureOpen();
          setTool("pencil");
        } else if (code === "KeyE") {
          ensureOpen();
          setTool("eraser");
        } else if (code === "KeyS") {
          ensureOpen();
          state.tool = "shape";
          popover.classList.toggle("is-open");
          syncUi();
        } else if (code === "KeyL") {
          ensureOpen();
          setTool("shape", "line");
        } else if (code === "KeyR") {
          ensureOpen();
          setTool("shape", "rect");
        } else if (code === "KeyO") {
          ensureOpen();
          setTool("shape", "circle");
        } else if (code === "KeyA") {
          ensureOpen();
          setTool("shape", "arrow");
        } else if (code === "Digit1" || code === "Numpad1") {
          ensureOpen();
          state.strokeWidth = WIDTHS[0];
          syncUi();
        } else if (code === "Digit2" || code === "Numpad2") {
          ensureOpen();
          state.strokeWidth = WIDTHS[1];
          syncUi();
        } else if (code === "Digit3" || code === "Numpad3") {
          ensureOpen();
          state.strokeWidth = WIDTHS[2];
          syncUi();
        } else handled = false;
        if (!handled) return;
        e.preventDefault();
        e.stopPropagation();
      },
      true
    );

    var panelPosKey = storagePrefix + "panel-pos";
    var dragState = {
      active: false,
      moved: false,
      fromFab: false,
      pointerId: null,
      dx: 0,
      dy: 0,
      left: 0,
      top: 0,
    };

    function clampPanelPos(left, top) {
      var pad = 8;
      var w = chrome.offsetWidth || 320;
      var h = chrome.offsetHeight || 120;
      var maxL = Math.max(pad, window.innerWidth - w - pad);
      var maxT = Math.max(pad, window.innerHeight - h - pad);
      return {
        left: Math.min(Math.max(pad, left), maxL),
        top: Math.min(Math.max(pad, top), maxT),
      };
    }

    function placeChrome(left, top) {
      var pos = clampPanelPos(left, top);
      chrome.classList.add("is-placed");
      chrome.style.left = pos.left + "px";
      chrome.style.top = pos.top + "px";
      chrome.style.right = "auto";
      chrome.style.bottom = "auto";
      return pos;
    }

    function persistChromePos(pos) {
      try {
        localStorage.setItem(panelPosKey, JSON.stringify(pos));
      } catch (err) {}
    }

    try {
      var savedPos = JSON.parse(localStorage.getItem(panelPosKey) || "null");
      if (savedPos && typeof savedPos.left === "number" && typeof savedPos.top === "number") {
        placeChrome(savedPos.left, savedPos.top);
      }
    } catch (errPos) {}

    function isDragHandleTarget(el) {
      if (!el) return false;
      if (dragHandle === el || dragHandle.contains(el)) return true;
      if (toggleBtn === el || toggleBtn.contains(el)) return true;
      if (!panel.contains(el)) return false;
      if (el.closest("button")) return false;
      if (el.closest("a")) return false;
      if (popover.contains(el)) return false;
      return true;
    }

    function onChromeMove(e) {
      if (!dragState.active || e.pointerId !== dragState.pointerId) return;
      var left = e.clientX - dragState.dx;
      var top = e.clientY - dragState.dy;
      if (!dragState.moved) {
        if (Math.abs(left - dragState.left) < 5 && Math.abs(top - dragState.top) < 5) return;
        dragState.moved = true;
        chrome.classList.add("is-dragging");
      }
      placeChrome(left, top);
      e.preventDefault();
    }

    function onChromeUp(e) {
      if (!dragState.active || (e && e.pointerId !== dragState.pointerId)) return;
      var fromFab = dragState.fromFab;
      var moved = dragState.moved;
      dragState.active = false;
      chrome.classList.remove("is-dragging");
      window.removeEventListener("pointermove", onChromeMove);
      window.removeEventListener("pointerup", onChromeUp);
      window.removeEventListener("pointercancel", onChromeUp);
      if (moved) {
        var rect = chrome.getBoundingClientRect();
        persistChromePos(placeChrome(rect.left, rect.top));
        return;
      }
      if (fromFab) toggleBoard();
    }

    function startChromeDrag(e, fromFab) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      var rect = chrome.getBoundingClientRect();
      dragState.active = true;
      dragState.moved = false;
      dragState.fromFab = !!fromFab;
      dragState.pointerId = e.pointerId;
      dragState.dx = e.clientX - rect.left;
      dragState.dy = e.clientY - rect.top;
      dragState.left = rect.left;
      dragState.top = rect.top;
      window.addEventListener("pointermove", onChromeMove);
      window.addEventListener("pointerup", onChromeUp);
      window.addEventListener("pointercancel", onChromeUp);
      e.preventDefault();
      e.stopPropagation();
    }

    toggleBtn.addEventListener("pointerdown", function (e) {
      startChromeDrag(e, true);
    });
    toggleBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
    });

    panel.addEventListener("pointerdown", function (e) {
      if (!isDragHandleTarget(e.target)) return;
      startChromeDrag(e, false);
    });

    window.addEventListener("resize", function () {
      slideStates.forEach(fitCanvas);
      if (!chrome.classList.contains("is-placed")) return;
      var rect = chrome.getBoundingClientRect();
      persistChromePos(placeChrome(rect.left, rect.top));
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", function () {
        slideStates.forEach(fitCanvas);
      });
    }
    window.addEventListener("hashchange", onActiveSlideChange);
    window.addEventListener(
      "scroll",
      function () {
        slideStates.forEach(syncLayerBox);
      },
      true
    );

    state.activeIndex = getActiveIndex();
    syncUi();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
  window.addEventListener("load", init);
})();
