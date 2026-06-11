(function () {
  "use strict";

  var config = window.__LESSON_DRAWING__ || {};
  var slug = config.slug || "lesson";
  var storagePrefix = "lesson-slide-draw-v1:" + slug + ":";

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

  function hitPencil(stroke, x, y) {
    var pad = stroke.size + 6;
    var pts = stroke.points || [];
    for (var i = 0; i < pts.length; i++) {
      if (Math.hypot(x - pts[i].x, y - pts[i].y) <= pad) return true;
    }
    for (var j = 0; j < pts.length - 1; j++) {
      if (distPointToSegment(x, y, pts[j].x, pts[j].y, pts[j + 1].x, pts[j + 1].y) <= pad) return true;
    }
    return false;
  }

  function hitRectStroke(stroke, x, y) {
    var pad = stroke.size + 6;
    var start = stroke.start;
    var end = stroke.end;
    var x0 = Math.min(start.x, end.x) - pad;
    var x1 = Math.max(start.x, end.x) + pad;
    var y0 = Math.min(start.y, end.y) - pad;
    var y1 = Math.max(start.y, end.y) + pad;
    return x >= x0 && x <= x1 && y >= y0 && y <= y1;
  }

  function hitCircleStroke(stroke, x, y) {
    var pad = stroke.size + 6;
    var cx = (stroke.start.x + stroke.end.x) / 2;
    var cy = (stroke.start.y + stroke.end.y) / 2;
    var r = Math.min(Math.abs(stroke.end.x - stroke.start.x), Math.abs(stroke.end.y - stroke.start.y)) / 2;
    return Math.hypot(x - cx, y - cy) <= r + pad;
  }

  function hitLineArrowStroke(stroke, x, y) {
    var pad = stroke.size + 6;
    return distPointToSegment(x, y, stroke.start.x, stroke.start.y, stroke.end.x, stroke.end.y) <= pad;
  }

  function findHitStroke(strokes, x, y) {
    for (var i = strokes.length - 1; i >= 0; i--) {
      var s = strokes[i];
      if (s.tool === "pencil" && hitPencil(s, x, y)) return s;
      if (s.tool === "shape" && s.shape === "rect" && hitRectStroke(s, x, y)) return s;
      if (s.tool === "shape" && s.shape === "circle" && hitCircleStroke(s, x, y)) return s;
      if (s.tool === "shape" && (s.shape === "line" || s.shape === "arrow") && hitLineArrowStroke(s, x, y)) return s;
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
    if (window.matchMedia && window.matchMedia("(max-width: 479px)").matches) return;

    var slides = Array.prototype.slice.call(document.querySelectorAll(".deck .slide"));
    if (!slides.length) slides = Array.prototype.slice.call(document.querySelectorAll(".slide"));
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
      slide.appendChild(layer);
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

    var btnCursor = makeToolBtn("cursor", "Курсор — прокрутка и выделение текста");
    var btnPencil = makeToolBtn("pencil", "Карандаш");
    var btnEraser = makeToolBtn("eraser", "Ластик");

    var shapesWrap = document.createElement("div");
    shapesWrap.className = "exam-drawing-panel__shapes-wrap";
    var btnShapes = makeToolBtn("shapes", "Фигуры");
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
        kind === "line" ? "Линия" : kind === "rect" ? "Прямоугольник" : kind === "circle" ? "Окружность" : "Стрелка";
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

    var btnUndo = makeToolBtn("undo", "Отменить последнее действие");
    var btnRedo = makeToolBtn("redo", "Вернуть отменённое действие");

    var sep2 = document.createElement("div");
    sep2.className = "toolbar-row1__sep";
    sep2.setAttribute("aria-hidden", "true");

    var btnClear = makeToolBtn("deleteAll", "Стереть всё");
    btnClear.className = "toolbar-row1__btn toolbar-row1__btn--danger";

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
    toggleBtn.title = "Черновик";
    toggleBtn.setAttribute("aria-label", "Черновик");
    toggleBtn.appendChild(svgFromHtml(ICONS.fabPencil));

    chrome.appendChild(panelWrap);
    chrome.appendChild(toggleBtn);
    root.appendChild(chrome);
    document.body.appendChild(root);

    function activeSlide() {
      return slideStates[state.activeIndex] || slideStates[0];
    }

    function getActiveIndex() {
      for (var i = 0; i < slideStates.length; i++) {
        if (slideStates[i].slide.classList.contains("active")) return i;
      }
      return state.activeIndex;
    }

    function fitCanvas(entry) {
      var canvas = entry.canvas;
      var slide = entry.slide;
      var dpr = window.devicePixelRatio || 1;
      var w = Math.max(1, Math.floor(slide.clientWidth * dpr));
      var h = Math.max(1, Math.floor(slide.clientHeight * dpr));
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
        entry.layer.classList.toggle("is-visible", state.boardOpen && isActive);
        var interactive = state.boardOpen && isActive && state.tool && state.tool !== "cursor";
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

    toggleBtn.addEventListener("click", function () {
      state.boardOpen = !state.boardOpen;
      if (state.boardOpen) state.tool = "cursor";
      else {
        state.tool = null;
        state.draft = null;
        state.redoStack = [];
      }
      syncUi();
    });

    btnCursor.addEventListener("click", function () {
      state.tool = "cursor";
      syncUi();
    });
    btnPencil.addEventListener("click", function () {
      state.tool = "pencil";
      syncUi();
    });
    btnEraser.addEventListener("click", function () {
      state.tool = "eraser";
      syncUi();
    });
    btnUndo.addEventListener("click", function () {
      var entry = activeSlide();
      if (!entry.strokes.length) return;
      state.redoStack.push(entry.strokes.pop());
      persistActive();
      syncUi();
    });
    btnRedo.addEventListener("click", function () {
      if (!state.redoStack.length) return;
      var entry = activeSlide();
      entry.strokes.push(state.redoStack.pop());
      persistActive();
      syncUi();
    });
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
      var hit = findHitStroke(entry.strokes, x, y);
      if (!hit) return;
      state.redoStack = [];
      entry.strokes = entry.strokes.filter(function (s) {
        return s.id !== hit.id;
      });
      persistActive();
      syncUi();
    }

    slideStates.forEach(function (entry) {
      entry.canvas.addEventListener("pointerdown", function (e) {
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
            entry.canvas.setPointerCapture(e.pointerId);
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
          entry.canvas.setPointerCapture(e.pointerId);
        } catch (err2) {}
        syncUi();
      });

      entry.canvas.addEventListener("pointermove", function (e) {
        if (entry.index !== state.activeIndex) return;
        var pt = clientToCanvas(entry.canvas, e.clientX, e.clientY);
        if (state.tool === "eraser" && state.boardOpen) {
          if (state.drawing) {
            e.preventDefault();
            eraseAt(entry, pt.x, pt.y);
          } else {
            var hit = findHitStroke(entry.strokes, pt.x, pt.y);
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
            entry.canvas.releasePointerCapture(e.pointerId);
          } catch (err) {}
          syncUi();
          return;
        }
        if (!state.drawing) return;
        state.drawing = false;
        try {
          entry.canvas.releasePointerCapture(e.pointerId);
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

      entry.canvas.addEventListener("pointerup", endPointer);
      entry.canvas.addEventListener("pointercancel", endPointer);

      // На iPad/Safari `touch-action: none` не всегда блокирует прокрутку при
      // рисовании пальцем/стилусом — гасим жесты явно, пока доска открыта.
      function blockTouch(e) {
        if (!state.boardOpen || entry.index !== state.activeIndex) return;
        if (state.tool === "cursor" || !state.tool) return;
        e.preventDefault();
      }
      entry.canvas.addEventListener("touchstart", blockTouch, { passive: false });
      entry.canvas.addEventListener("touchmove", blockTouch, { passive: false });
    });

    state.activeIndex = getActiveIndex();
    syncUi();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
