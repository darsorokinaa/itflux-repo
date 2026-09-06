import { useCallback, useEffect, useRef, useState } from "react";

const IMAGE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp,.png,.jpg,.jpeg,.gif,.webp";

const CONDITION_MATH = [
  { id: "pow", label: "x²", insert: "x^{2}", title: "Степень" },
  { id: "sum", label: "Σ", insert: "\\sum", title: "Сумма" },
  { id: "sqrt", label: "√", insert: "\\sqrt{}", title: "Корень" },
];

const ANSWER_MATH = [
  { id: "pow", label: "x²", insert: "x^{2}", title: "Степень" },
  { id: "sqrt", label: "√", insert: "\\sqrt{}", title: "Корень" },
  { id: "div", label: "÷", insert: "\\div", title: "Деление" },
];

function insertPlainAtSelection(root, text, savedRange) {
  insertNodeAtSelection(root, document.createTextNode(text), savedRange);
}

function insertNodeAtSelection(root, node, savedRange) {
  if (!root || !node) return;
  root.focus();
  const sel = window.getSelection();
  let range = null;
  if (savedRange && root.contains(savedRange.commonAncestorContainer)) {
    range = savedRange;
  } else if (sel && sel.rangeCount && (root === sel.anchorNode || root.contains(sel.anchorNode))) {
    range = sel.getRangeAt(0);
  }
  if (!range) {
    range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
  }
  range.deleteContents();
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function toEditorMediaUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw, window.location.origin);
    if (parsed.pathname.startsWith("/media/")) return `${parsed.pathname}${parsed.search}`;
  } catch {
    /* keep raw */
  }
  return raw.replace(/^https?:\/\/(?:127\.0\.0\.1|localhost):8000/i, "");
}

function exec(command, value = null) {
  try {
    document.execCommand(command, false, value);
  } catch {
    /* ignore */
  }
}

function LatexModal({ open, initial = "", onClose, onInsert }) {
  const [tex, setTex] = useState(initial);
  const [display, setDisplay] = useState(false);
  const previewRef = useRef(null);

  useEffect(() => {
    if (open) {
      setTex(initial || "");
      setDisplay(false);
    }
  }, [open, initial]);

  useEffect(() => {
    const el = previewRef.current;
    if (!open || !el) return undefined;
    const raw = String(tex || "").trim();
    el.replaceChildren();
    if (!raw) {
      el.textContent = "";
      return undefined;
    }
    const wrapped = display ? `$$${raw}$$` : `$${raw}$`;
    el.textContent = wrapped;
    const mj = window.MathJax;
    if (!mj?.typesetPromise) return undefined;
    let cancelled = false;
    mj.typesetPromise([el]).then(() => {
      if (cancelled) return;
      const err = el.querySelector("mjx-merror, .MathJax_Error, [data-mjx-error]");
      if (err) {
        el.replaceChildren();
        const msg = document.createElement("span");
        msg.className = "mtb-math-error-msg";
        msg.textContent = "Не удалось отобразить формулу";
        el.appendChild(msg);
      }
    }).catch(() => {
      if (cancelled) return;
      el.replaceChildren();
      const msg = document.createElement("span");
      msg.className = "mtb-math-error-msg";
      msg.textContent = "Не удалось отобразить формулу";
      el.appendChild(msg);
    });
    return () => {
      cancelled = true;
    };
  }, [open, tex, display]);

  if (!open) return null;

  return (
    <div className="mtb-modal" role="dialog" aria-modal="true" aria-label="Вставить формулу">
      <button type="button" className="mtb-modal__backdrop" aria-label="Закрыть" onClick={onClose} />
      <div className="mtb-modal__card">
        <p className="mtb-modal__title">Введите формулу</p>
        <textarea
          className="mtb-textarea mtb-textarea--formula"
          autoFocus
          value={tex}
          onChange={(e) => setTex(e.target.value)}
          placeholder="x^2 + 5x - 6 = 0"
        />
        <div className="mtb-formula-mode">
          <label>
            <input type="radio" checked={!display} onChange={() => setDisplay(false)} />
            Inline
          </label>
          <label>
            <input type="radio" checked={display} onChange={() => setDisplay(true)} />
            Блочная
          </label>
        </div>
        <p className="mtb-field__label">Предпросмотр</p>
        <div ref={previewRef} className="mtb-formula-preview" />
        <div className="mtb-modal__actions">
          <button type="button" className="mtb-btn" onClick={onClose}>Отмена</button>
          <button
            type="button"
            className="mtb-btn mtb-btn--primary"
            disabled={!String(tex || "").trim()}
            onClick={() => {
              const raw = String(tex || "").trim();
              if (!raw) return;
              onInsert(display ? `$$${raw}$$` : `$${raw}$`);
              onClose();
            }}
          >
            Вставить
          </button>
        </div>
      </div>
    </div>
  );
}

function ToolbarBtn({ label, title, onClick, active, children }) {
  return (
    <button
      type="button"
      className={`mtb-rte__btn${active ? " is-active" : ""}`}
      title={title || label}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
    >
      {children ?? label}
    </button>
  );
}

const MIN_IMG_W = 72;
const DEFAULT_IMG_W = 320;

function ImageToolIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 5h16v14H4V5Z" stroke="currentColor" strokeWidth="1.7" />
      <path d="m7 16 3.5-4 2.7 3 1.8-2 2 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9" cy="9" r="1" fill="currentColor" />
    </svg>
  );
}

function FileToolIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M14 3v5h5" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function applyImageSize(img, widthPx, maxWidth) {
  if (!img) return 0;
  const cap = Math.max(MIN_IMG_W, Math.round(maxWidth || 720));
  const w = Math.min(cap, Math.max(MIN_IMG_W, Math.round(widthPx)));
  img.classList.add("teacher-task-img");
  img.style.width = `${w}px`;
  img.style.maxWidth = "100%";
  img.style.height = "auto";
  img.style.setProperty("--teacher-img-w", `${w}px`);
  img.setAttribute("width", String(w));
  img.removeAttribute("height");
  return w;
}

function normalizeEditorImages(root) {
  if (!root) return;
  root.querySelectorAll("img").forEach((img) => {
    img.classList.add("teacher-task-img");
    const fromStyle = parseInt(img.style.width, 10);
    const fromAttr = parseInt(img.getAttribute("width") || "", 10);
    const w = Number.isFinite(fromStyle) && fromStyle > 0
      ? fromStyle
      : Number.isFinite(fromAttr) && fromAttr > 0
        ? fromAttr
        : 0;
    if (w) {
      img.style.setProperty("--teacher-img-w", `${w}px`);
      if (!img.style.width) img.style.width = `${w}px`;
      img.style.height = "auto";
    }
  });
}

export function TeacherTaskRichEditor({
  value,
  onChange,
  placeholder,
  onUploadImage,
  onAttachFile,
  onAttachIntent,
  disabled,
}) {
  const editorRef = useRef(null);
  const wrapRef = useRef(null);
  const imageInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const lastValue = useRef("");
  const savedRange = useRef(null);
  const selectedImgRef = useRef(null);
  const dragRef = useRef(null);
  const [formulaOpen, setFormulaOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState("");
  const [selectedImg, setSelectedImg] = useState(null);
  const [frame, setFrame] = useState(null);

  const editorMaxWidth = () => Math.max(MIN_IMG_W + 8, (editorRef.current?.clientWidth || 480) - 32);

  const rememberRange = () => {
    const el = editorRef.current;
    const sel = window.getSelection();
    if (sel && sel.rangeCount && el && (el === sel.anchorNode || el.contains(sel.anchorNode))) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
  };

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const next = value || "";
    if (next !== lastValue.current && document.activeElement !== el) {
      el.innerHTML = next || "";
      lastValue.current = next;
      normalizeEditorImages(el);
    }
  }, [value]);

  const emit = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    normalizeEditorImages(el);
    const html = el.innerHTML;
    lastValue.current = html;
    onChange(html);
  }, [onChange]);

  const syncFrame = useCallback(() => {
    const wrap = wrapRef.current;
    const img = selectedImgRef.current;
    if (!wrap || !img?.isConnected) {
      setFrame(null);
      return;
    }
    const wr = wrap.getBoundingClientRect();
    const ir = img.getBoundingClientRect();
    setFrame({
      left: ir.left - wr.left,
      top: ir.top - wr.top,
      width: ir.width,
      height: ir.height,
    });
  }, []);

  useEffect(() => {
    selectedImgRef.current = selectedImg;
    syncFrame();
    if (!selectedImg) return undefined;
    const onWin = () => syncFrame();
    window.addEventListener("resize", onWin);
    window.addEventListener("scroll", onWin, true);
    return () => {
      window.removeEventListener("resize", onWin);
      window.removeEventListener("scroll", onWin, true);
    };
  }, [selectedImg, syncFrame, value]);

  useEffect(() => {
    if (!selectedImg) return undefined;
    const onKey = (event) => {
      if (event.key !== "Backspace" && event.key !== "Delete") return;
      if (event.target?.closest?.(".mtb-modal")) return;
      const tag = event.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      event.preventDefault();
      selectedImg.remove();
      setSelectedImg(null);
      emit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedImg, emit]);

  const insertLatex = (snippet) => {
    const wrapped = snippet.startsWith("$") ? snippet : `$${snippet}$`;
    insertPlainAtSelection(editorRef.current, wrapped, savedRange.current);
    emit();
  };

  const sizeInsertedImage = (img) => {
    const fit = (natural) => {
      const maxW = editorMaxWidth();
      const target = natural > 0 ? Math.min(natural, maxW, DEFAULT_IMG_W) : Math.min(maxW, DEFAULT_IMG_W);
      applyImageSize(img, target, maxW);
      setSelectedImg(img);
      emit();
      requestAnimationFrame(syncFrame);
    };
    if (img.complete && img.naturalWidth) {
      fit(img.naturalWidth);
      return;
    }
    img.addEventListener("load", () => fit(img.naturalWidth), { once: true });
  };

  const insertImage = async (file) => {
    if (!file || !onUploadImage) return;
    rememberRange();
    setBusy(true);
    setHint("Загрузка изображения…");
    try {
      const url = toEditorMediaUrl(await onUploadImage(file));
      if (!url) throw new Error("Не удалось загрузить изображение");
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      img.className = "teacher-task-img";
      insertNodeAtSelection(editorRef.current, img, savedRange.current);
      sizeInsertedImage(img);
      setHint("");
    } catch (err) {
      setHint(err instanceof Error ? err.message : "Не удалось загрузить изображение");
    } finally {
      setBusy(false);
    }
  };

  const attachFile = async (file) => {
    if (!file || !onAttachFile) return;
    setBusy(true);
    setHint("Загрузка файла…");
    try {
      await onAttachFile(file);
      setHint("");
    } catch (err) {
      setHint(err instanceof Error ? err.message : "Не удалось прикрепить файл");
    } finally {
      setBusy(false);
    }
  };

  const onPaste = (event) => {
    const items = Array.from(event.clipboardData?.items || []);
    const imageItem = items.find((item) => item.type.startsWith("image/"));
    if (!imageItem) return;
    event.preventDefault();
    insertImage(imageItem.getAsFile());
  };

  const onDrop = (event) => {
    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length) return;
    event.preventDefault();
    const image = files.find((item) => item.type.startsWith("image/"));
    if (image) {
      insertImage(image);
      return;
    }
    attachFile(files[0]);
  };

  const selectImage = (img) => {
    if (!img) {
      setSelectedImg(null);
      return;
    }
    const current = img.getBoundingClientRect().width || DEFAULT_IMG_W;
    applyImageSize(img, current, editorMaxWidth());
    setSelectedImg(img);
    requestAnimationFrame(syncFrame);
  };

  const bumpSize = (factor) => {
    const img = selectedImg;
    if (!img) return;
    applyImageSize(img, img.getBoundingClientRect().width * factor, editorMaxWidth());
    emit();
    requestAnimationFrame(syncFrame);
  };

  const onHandlePointerDown = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const img = selectedImg;
    if (!img) return;
    dragRef.current = { startX: event.clientX, startW: img.getBoundingClientRect().width };
    const onMove = (ev) => {
      const drag = dragRef.current;
      if (!drag) return;
      applyImageSize(img, drag.startW + (ev.clientX - drag.startX), editorMaxWidth());
      syncFrame();
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      emit();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div className={`mtb-rte${disabled ? " is-disabled" : ""}`} ref={wrapRef}>
      <div className="mtb-rte__bar" role="toolbar" aria-label="Форматирование условия">
        <ToolbarBtn title="Жирный" onClick={() => { exec("bold"); emit(); }}>
          <b>B</b>
        </ToolbarBtn>
        <ToolbarBtn title="Курсив" onClick={() => { exec("italic"); emit(); }}>
          <i>I</i>
        </ToolbarBtn>
        <span className="mtb-rte__sep" />
        {CONDITION_MATH.map((item) => (
          <ToolbarBtn
            key={item.id}
            label={item.label}
            title={item.title}
            onClick={() => insertLatex(item.insert)}
          />
        ))}
        <span className="mtb-rte__sep" />
        <ToolbarBtn
          title="Вставить изображение"
          onClick={() => {
            rememberRange();
            imageInputRef.current?.click();
          }}
        >
          <ImageToolIcon />
        </ToolbarBtn>
        {onAttachFile ? (
          <ToolbarBtn
            title="Прикрепить файл"
            onClick={() => {
              if (onAttachIntent && onAttachIntent() === false) return;
              fileInputRef.current?.click();
            }}
          >
            <FileToolIcon />
          </ToolbarBtn>
        ) : null}
        <button
          type="button"
          className="mtb-rte__latex"
          title="Вставить формулу LaTeX"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setFormulaOpen(true)}
        >
          LaTeX
        </button>
      </div>
      <div
        ref={editorRef}
        className="mtb-rte__surface"
        contentEditable={!disabled}
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder || ""}
        onInput={emit}
        onPaste={onPaste}
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        onBlur={rememberRange}
        onKeyUp={rememberRange}
        onMouseUp={(event) => {
          rememberRange();
          if (event.target?.tagName === "IMG") selectImage(event.target);
          else setSelectedImg(null);
        }}
        onClick={(event) => {
          if (event.target?.tagName === "IMG") selectImage(event.target);
        }}
        suppressContentEditableWarning
      />
      {frame && selectedImg ? (
        <div
          className="mtb-img-resize"
          style={{ left: frame.left, top: frame.top, width: frame.width, height: frame.height }}
        >
          <div className="mtb-img-resize__tools">
            <button type="button" title="Уменьшить" onMouseDown={(e) => e.preventDefault()} onClick={() => bumpSize(0.82)}>−</button>
            <span>{Math.round(frame.width)}px</span>
            <button type="button" title="Увеличить" onMouseDown={(e) => e.preventDefault()} onClick={() => bumpSize(1.22)}>+</button>
          </div>
          <button
            type="button"
            className="mtb-img-resize__handle"
            aria-label="Изменить размер картинки"
            onPointerDown={onHandlePointerDown}
          />
        </div>
      ) : null}
      {busy ? <p className="mtb-hint">{hint || "Загрузка…"}</p> : null}
      {hint && !busy ? <p className="mtb-error">{hint}</p> : null}
      <input
        ref={imageInputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) insertImage(file);
        }}
      />
      {onAttachFile ? (
        <input
          ref={fileInputRef}
          type="file"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) attachFile(file);
          }}
        />
      ) : null}
      <LatexModal open={formulaOpen} onClose={() => setFormulaOpen(false)} onInsert={insertLatex} />
    </div>
  );
}

export function TeacherTaskAnswerEditor({ value, onChange, placeholder }) {
  const areaRef = useRef(null);
  const [formulaOpen, setFormulaOpen] = useState(false);

  const insertAtCursor = (text) => {
    const el = areaRef.current;
    if (!el) {
      onChange(`${value || ""}${text}`);
      return;
    }
    const start = el.selectionStart ?? String(value || "").length;
    const end = el.selectionEnd ?? start;
    const next = `${String(value || "").slice(0, start)}${text}${String(value || "").slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="mtb-answer-edit">
      <div className="mtb-rte__bar mtb-rte__bar--compact" role="toolbar" aria-label="Формулы в ответе">
        {ANSWER_MATH.map((item) => (
          <ToolbarBtn
            key={item.id}
            label={item.label}
            title={item.title}
            onClick={() => insertAtCursor(`$${item.insert}$`)}
          />
        ))}
        <button
          type="button"
          className="mtb-rte__latex"
          title="Вставить формулу LaTeX"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setFormulaOpen(true)}
        >
          LaTeX
        </button>
      </div>
      <textarea
        ref={areaRef}
        className="mtb-textarea mtb-textarea--answer"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      <LatexModal open={formulaOpen} onClose={() => setFormulaOpen(false)} onInsert={insertAtCursor} />
    </div>
  );
}

export function TeacherTaskPreviewMath({ children, className }) {
  const wrapRef = useRef(null);

  useEffect(() => {
    const root = wrapRef.current;
    if (!root) return undefined;
    const mark = () => {
      root.querySelectorAll("mjx-merror, .MathJax_Error, [data-mjx-error]").forEach((node) => {
        node.classList.add("mtb-math-error");
        const next = node.nextElementSibling;
        if (next?.classList.contains("mtb-math-error-msg")) return;
        const msg = document.createElement("span");
        msg.className = "mtb-math-error-msg";
        msg.textContent = "Не удалось отобразить формулу";
        node.after(msg);
      });
    };
    const observer = new MutationObserver(mark);
    observer.observe(root, { childList: true, subtree: true });
    const timer = window.setInterval(mark, 400);
    mark();
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, [children]);

  return (
    <div ref={wrapRef} className={className}>
      {children}
    </div>
  );
}
