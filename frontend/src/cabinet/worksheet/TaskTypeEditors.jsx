import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ensureCsrfCookie, getCsrfToken } from "../../utils/cabinetAuth";
import FormulaEditor from "./FormulaEditor";
import {
  TASK_TYPE_GROUPS,
  TASK_TYPE_REGISTRY,
  canonicalType,
  evalSafe,
  getTaskSpec,
  normalizeTask,
  uid,
} from "./taskTypeRegistry";

function Field({ label, children }) {
  return (
    <div className="ws-type-field">
      <span>{label}</span>
      {children}
    </div>
  );
}

function sync(task, patch) {
  const next = {
    ...task,
    ...patch,
    content: patch.content ? { ...task.content, ...patch.content } : task.content,
    answer: patch.answer ? { ...task.answer, ...patch.answer } : task.answer,
  };
  if (patch.question != null) next.q = patch.question;
  return next;
}

function stripTags(html) {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  return div.textContent || "";
}

function readTex(html) {
  const text = stripTags(html);
  const wrapped = text.match(/\\\[([\s\S]*?)\\\]/) || text.match(/\\\(([\s\S]*?)\\\)/) || text.match(/\$\$([\s\S]+?)\$\$/) || text.match(/\$([^$]+)\$/);
  return wrapped ? wrapped[1].trim() : "";
}

function withTex(html, tex, display = false) {
  const wrapped = display ? `\\[${tex}\\]` : `\\(${tex}\\)`;
  const source = html || "";
  if (/\\\[[\s\S]*?\\\]/.test(source)) return source.replace(/\\\[[\s\S]*?\\\]/, wrapped);
  if (/\\\([\s\S]*?\\\)/.test(source)) return source.replace(/\\\([\s\S]*?\\\)/, wrapped);
  if (/\$\$[\s\S]+?\$\$/.test(source)) return source.replace(/\$\$[\s\S]+?\$\$/, wrapped);
  if (/\$(?!\$)[^$]+\$/.test(source)) return source.replace(/\$(?!\$)[^$]+\$/, wrapped);
  return `${source}${source && !source.endsWith(" ") ? " " : ""}${wrapped}`;
}

export function FormulaTextField({ value, onChange, rows = 3, placeholder, ariaLabel }) {
  const [formulaOpen, setFormulaOpen] = useState(false);
  const [formulaTex, setFormulaTex] = useState("");
  const text = value || "";
  return (
    <>
      <div className="ws-q-box">
        <textarea
          rows={rows}
          value={text}
          placeholder={placeholder}
          spellCheck={false}
          aria-label={ariaLabel}
          onChange={(event) => onChange(event.target.value)}
        />
        {formulaOpen ? null : (
          <div className="ws-q-box__bar">
            <button
              type="button"
              className="ws-eq-open"
              onClick={() => {
                setFormulaTex(readTex(text));
                setFormulaOpen(true);
              }}
            >
              Вставить формулу
            </button>
          </div>
        )}
      </div>
      {formulaOpen ? (
        <FormulaEditor
          embedded
          value={formulaTex}
          onChange={setFormulaTex}
          onClose={() => setFormulaOpen(false)}
          onApply={(display) => {
            onChange(withTex(text, formulaTex.trim(), display));
            setFormulaOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function QuestionField({ task, onChange }) {
  const value = task.question || task.q || "";
  return (
    <Field label="Условие">
      <FormulaTextField
        value={value}
        rows={2}
        ariaLabel="Условие"
        onChange={(next) => onChange(sync(task, { question: next }))}
      />
    </Field>
  );
}

function Preview({ view, children }) {
  return (
    <div className={`ws-type-preview is-${view}`}>
      <span>{view === "teacher" ? "Учитель" : "Ученик"}</span>
      {children}
    </div>
  );
}

function groupsFor(subject, type) {
  const current = type ? canonicalType(type) : "";
  return TASK_TYPE_GROUPS.map((group) => ({
    ...group,
    types: group.types.filter((id) => {
      const only = TASK_TYPE_REGISTRY[id]?.subjects;
      if (!only) return true;
      return only.includes(subject) || current === id;
    }),
  })).filter((group) => group.types.length);
}

export function TaskTypePicker({ type, onChange, label, subject = "Математика" }) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState(null);
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const spec = type ? getTaskSpec(type) : null;

  useEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const node = rootRef.current?.querySelector(".ws-type-picker__btn");
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const width = Math.min(360, Math.max(rect.width, 260), window.innerWidth - 16);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const below = window.innerHeight - rect.bottom;
      const above = rect.top;
      const upward = below < 220 && above > below;
      const maxHeight = Math.max(120, (upward ? above : below) - 8);
      setBox({
        left,
        width,
        maxHeight,
        top: upward ? Math.max(8, rect.top - maxHeight - 4) : rect.bottom + 4,
      });
    };
    place();
    const onPointer = (event) => {
      const target = event.target;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  return (
    <div className="ws-type-picker" ref={rootRef}>
      <button type="button" className="ws-type-picker__btn" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }}>
        {label || spec?.label || "Тип"}
      </button>
      {open && box ? createPortal(
        <div
          ref={menuRef}
          className="ws-type-picker__menu"
          style={{ top: box.top, left: box.left, width: box.width, maxHeight: box.maxHeight }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {groupsFor(subject, type).map((group) => (
            <section key={group.id}>
              <strong>{group.label}</strong>
              {group.types.map((id) => {
                const item = TASK_TYPE_REGISTRY[id];
                return (
                  <button key={id} type="button" className={type && canonicalType(type) === id ? "is-on" : ""} onClick={() => { onChange(id); setOpen(false); }}>
                    <b>{item.label}</b>
                    <small>{item.hint}</small>
                  </button>
                );
              })}
            </section>
          ))}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

function ShortAnswerEditor({ task, onChange }) {
  const kind = task.content.answerKind;
  const values = task.answer.values || [""];
  return (
    <>
      <QuestionField task={task} onChange={onChange} />
      <Field label="Правильный ответ">
        <input value={values[0] || ""} onChange={(event) => onChange(sync(task, { answer: { values: [event.target.value, ...values.slice(1)] } }))} />
      </Field>
      <Field label="Тип ответа">
        <div className="ws-type-choice ws-opt-grid">
          {[
            ["number", "Число"],
            ["text", "Текст"],
            ["formula", "Формула"],
            ["many", "Несколько"],
          ].map(([id, label]) => (
            <label key={id}><input type="radio" checked={kind === id} onChange={() => onChange(sync(task, { content: { answerKind: id } }))} /> {label}</label>
          ))}
        </div>
      </Field>
      {kind === "number" ? (
        <Field label="Допустимая погрешность">
          <input value={task.content.tolerance ?? 0} onChange={(event) => onChange(sync(task, { content: { tolerance: event.target.value } }))} />
        </Field>
      ) : null}
      {kind === "text" || kind === "many" ? (
        <div className="ws-type-choice">
          <label><input type="checkbox" checked={task.content.caseInsensitive !== false} onChange={(event) => onChange(sync(task, { content: { caseInsensitive: event.target.checked } }))} /> не учитывать регистр</label>
          <label><input type="checkbox" checked={task.content.ignoreSpaces !== false} onChange={(event) => onChange(sync(task, { content: { ignoreSpaces: event.target.checked } }))} /> игнорировать лишние пробелы</label>
        </div>
      ) : null}
      {kind === "many" ? (
        <div className="ws-type-list">
          {values.map((value, index) => (
            <input key={index} value={value} placeholder="Допустимый ответ" onChange={(event) => {
              const next = [...values];
              next[index] = event.target.value;
              onChange(sync(task, { answer: { values: next } }));
            }} />
          ))}
          <button type="button" onClick={() => onChange(sync(task, { answer: { values: [...values, ""] } }))}>+ Добавить допустимый ответ</button>
        </div>
      ) : null}
    </>
  );
}

function SolutionEditor({ task, onChange }) {
  return (
    <>
      <QuestionField task={task} onChange={onChange} />
      <p className="ws-section-label">Ответ</p>
      <Field label="Правильный конечный ответ"><input value={task.answer.final || ""} onChange={(event) => onChange(sync(task, { answer: { final: event.target.value } }))} /></Field>
      <Field label="Эталонное решение"><textarea rows={4} value={task.answer.solution || ""} placeholder="Ученик увидит его после проверки" onChange={(event) => onChange(sync(task, { answer: { solution: event.target.value } }))} /></Field>
      <p className="ws-section-label">Поля ученика</p>
      <div className="ws-type-choice">
        <label><input type="checkbox" checked={task.content.showWork !== false} onChange={(event) => onChange(sync(task, { content: { showWork: event.target.checked } }))} /> Место для решения</label>
        <label><input type="checkbox" checked={task.content.showAnswer !== false} onChange={(event) => onChange(sync(task, { content: { showAnswer: event.target.checked } }))} /> Поле конечного ответа</label>
      </div>
      <Field label="Проверка">
        <div className="ws-type-choice">
          {[["manual", "Вручную"], ["final", "По конечному ответу"]].map(([id, label]) => (
            <label key={id}><input type="radio" checked={(task.content.checkMode || "manual") === id} onChange={() => onChange(sync(task, { content: { checkMode: id } }))} /> {label}</label>
          ))}
        </div>
      </Field>
      {task.content.showWork !== false ? (
        <Field label="Размер пространства">
          <div className="ws-type-choice">
            {[["auto", "Автоматически"], ["2", "2 строки"], ["4", "4 строки"], ["6", "6 строк"], ["large", "Большое поле"]].map(([id, label]) => (
              <label key={id}><input type="radio" checked={String(task.content.lines || "auto") === id} onChange={() => onChange(sync(task, { content: { lines: id } }))} /> {label}</label>
            ))}
          </div>
        </Field>
      ) : null}
    </>
  );
}

function ChoiceEditor({ task, onChange }) {
  const options = task.answer.options || [];
  const setOptions = (next) => onChange(sync(task, { answer: { options: next } }));
  return (
    <>
      <QuestionField task={task} onChange={onChange} />
      <p className="ws-section-label">Тип выбора</p>
      <div className="ws-type-choice">
        <label><input type="radio" checked={!task.content.multiple} onChange={() => {
          const first = options.findIndex((option) => option.correct);
          onChange(sync(task, { content: { multiple: false }, answer: { options: options.map((item, index) => ({ ...item, correct: index === (first < 0 ? 0 : first) })) } }));
        }} /> Один правильный</label>
        <label><input type="radio" checked={!!task.content.multiple} onChange={() => onChange(sync(task, { content: { multiple: true } }))} /> Несколько правильных</label>
      </div>
      <p className="ws-section-label">Варианты</p>
      <div className="ws-type-list">
        {options.map((option) => (
          <div key={option.id} className="ws-option-row">
            <input
              type={task.content.multiple ? "checkbox" : "radio"}
              name={`correct-${options.map((item) => item.id).join("-")}`}
              checked={!!option.correct}
              aria-label="Правильный вариант"
              onChange={() => setOptions(options.map((item) => ({
                ...item,
                correct: task.content.multiple ? (item.id === option.id ? !item.correct : item.correct) : item.id === option.id,
              })))}
            />
            <input value={option.text} placeholder="Текст варианта" onChange={(event) => setOptions(options.map((item) => item.id === option.id ? { ...item, text: event.target.value } : item))} />
            <button type="button" className="ws-icon-btn" aria-label="Удалить вариант" onClick={() => setOptions(options.filter((item) => item.id !== option.id).map((item, itemIndex) => ({ ...item, label: String.fromCharCode(65 + itemIndex) })))}>×</button>
          </div>
        ))}
        <button type="button" onClick={() => setOptions([...options, { id: uid("opt"), label: String.fromCharCode(65 + options.length), text: `Вариант ${options.length + 1}`, correct: false }])}>+ Добавить вариант</button>
      </div>
      <p className="ws-section-label">Дополнительно</p>
      <label><input type="checkbox" checked={task.content.shuffle !== false} onChange={(event) => onChange(sync(task, { content: { shuffle: event.target.checked } }))} /> Перемешивать варианты ученику</label>
    </>
  );
}

function readElementImage(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve("");
    reader.onload = () => {
      const source = String(reader.result || "");
      const image = new Image();
      image.onload = () => {
        const max = 480;
        const scale = Math.min(1, max / Math.max(image.width, image.height, 1));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        if (!context) {
          resolve(source);
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const webp = canvas.toDataURL("image/webp", 0.86);
        resolve(webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/png"));
      };
      image.onerror = () => resolve(source);
      image.src = source;
    };
    reader.readAsDataURL(file);
  });
}

function PictureControl({ image, label, onChange }) {
  const ref = useRef(null);
  return (
    <span className="ws-el-pic">
      {image ? <img src={image} alt="" /> : null}
      <button type="button" className="ws-icon-btn" aria-label={image ? `Заменить рисунок, ${label}` : `Добавить рисунок, ${label}`} onClick={() => ref.current?.click()}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="5.4" cy="6" r="1" fill="currentColor" />
          <path d="M2.2 11.2 5.4 8.2 7.6 10.2 10 7.4 13.8 11.2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      </button>
      {image ? <button type="button" className="ws-icon-btn" aria-label={`Убрать рисунок, ${label}`} onClick={() => onChange("")}>×</button> : null}
      <input
        ref={ref}
        className="ws-el-file"
        type="file"
        accept="image/*"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) readElementImage(file).then(onChange);
        }}
      />
    </span>
  );
}

function ElementFace({ text, image }) {
  const label = String(text || "").trim();
  return (
    <span className="ws-el-face">
      {image ? <img src={image} alt={label || "Рисунок"} /> : null}
      {label || (image ? null : "…")}
    </span>
  );
}

function MatchingEditor({ task, onChange }) {
  const pairs = task.answer.pairs || [];
  const setPairs = (next) => onChange(sync(task, { answer: { pairs: next } }));
  const patch = (id, fields) => setPairs(pairs.map((item) => item.leftId === id ? { ...item, ...fields } : item));
  return (
    <>
      <QuestionField task={task} onChange={onChange} />
      <div className="ws-type-list">
        {pairs.map((pair, index) => (
          <div key={pair.leftId} className="ws-match-edit">
            <b>{String.fromCharCode(65 + index)}</b>
            <div className="ws-match-side">
              <input aria-label={`Элемент ${String.fromCharCode(65 + index)}`} value={pair.left || ""} placeholder="Элемент" onChange={(event) => patch(pair.leftId, { left: event.target.value })} />
              <PictureControl image={pair.leftImage} label={`элемент ${String.fromCharCode(65 + index)}`} onChange={(leftImage) => patch(pair.leftId, { leftImage })} />
            </div>
            <span aria-hidden="true">→</span>
            <div className="ws-match-side">
              <input aria-label={`Вариант ${index + 1}`} value={pair.right || ""} placeholder="Вариант" onChange={(event) => patch(pair.leftId, { right: event.target.value })} />
              <PictureControl image={pair.rightImage} label={`вариант ${index + 1}`} onChange={(rightImage) => patch(pair.leftId, { rightImage })} />
            </div>
            <button type="button" className="ws-icon-btn" aria-label="Удалить пару" onClick={() => setPairs(pairs.filter((item) => item.leftId !== pair.leftId))}>×</button>
          </div>
        ))}
        <button type="button" onClick={() => setPairs([...pairs, { leftId: uid("L"), rightId: uid("R"), left: "", right: "" }])}>+ Добавить пару</button>
      </div>
      <div className="ws-type-choice">
        <label><input type="checkbox" checked={task.content.shuffleRight !== false} onChange={(event) => onChange(sync(task, { content: { shuffleRight: event.target.checked } }))} /> перемешивать правую колонку</label>
        <label><input type="checkbox" checked={!!task.content.reuseRight} onChange={(event) => onChange(sync(task, { content: { reuseRight: event.target.checked } }))} /> один элемент справа может использоваться несколько раз</label>
      </div>
    </>
  );
}

function mergeTextParts(parts) {
  const merged = [];
  parts.forEach((part) => {
    const prev = merged[merged.length - 1];
    if (part.type === "text" && prev?.type === "text") merged[merged.length - 1] = { ...prev, value: `${prev.value || ""}${part.value || ""}` };
    else merged.push({ ...part });
  });
  return merged.length ? merged : [{ type: "text", value: "" }];
}

function blankKindFor(text) {
  return /^-?\d+([.,]\d+)?$/.test(text) ? "number" : "text";
}

function BlankSentence({ task, onChange, variant = "inspector" }) {
  const rootRef = useRef(null);
  const [offer, setOffer] = useState(null);
  const parts = task.content.parts?.length ? task.content.parts : [{ type: "text", value: "" }];
  const blanks = task.answer.blanks || {};
  const selected = task.content.selectedBlank;
  const editable = Boolean(onChange);

  const commit = (nextParts, nextBlanks, selectedBlank) => {
    onChange(sync(task, {
      content: { parts: nextParts, ...(selectedBlank !== undefined ? { selectedBlank } : {}) },
      answer: nextBlanks ? { blanks: nextBlanks } : task.answer,
    }));
  };

  const setText = (index, value) => {
    if ((parts[index]?.value || "") === value) return;
    commit(parts.map((item, itemIndex) => itemIndex === index ? { ...item, value } : item));
  };

  useEffect(() => {
    if (!editable) return undefined;
    const readSelection = () => {
      const root = rootRef.current;
      const sel = window.getSelection();
      if (!root || !sel?.rangeCount || sel.isCollapsed) {
        setOffer((current) => (current ? null : current));
        return;
      }
      const range = sel.getRangeAt(0);
      const span = [...root.querySelectorAll("[data-kind='text']")].find((node) => node.contains(range.startContainer) && node.contains(range.endContainer));
      const partIndex = Number(span?.dataset.part);
      if (!span || !Number.isInteger(partIndex) || partIndex < 0) {
        setOffer((current) => (current ? null : current));
        return;
      }
      const pre = document.createRange();
      pre.selectNodeContents(span);
      pre.setEnd(range.startContainer, range.startOffset);
      const start = pre.toString().length;
      const text = range.toString();
      if (!text.trim()) {
        setOffer((current) => (current ? null : current));
        return;
      }
      const rect = range.getBoundingClientRect();
      const next = {
        partIndex,
        start,
        end: start + text.length,
        top: Math.min(rect.bottom + 6, window.innerHeight - 40),
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 176)),
      };
      setOffer((current) => (current && current.partIndex === next.partIndex && current.start === next.start && current.end === next.end ? current : next));
    };
    document.addEventListener("selectionchange", readSelection);
    return () => document.removeEventListener("selectionchange", readSelection);
  }, [editable, parts]);

  const makeBlank = () => {
    const part = parts[offer?.partIndex];
    if (!part || part.type !== "text") return;
    const value = part.value || "";
    const answer = value.slice(offer.start, offer.end).trim();
    if (!answer) return;
    const id = uid("blank");
    const chunks = [];
    if (offer.start > 0) chunks.push({ type: "text", value: value.slice(0, offer.start) });
    chunks.push({ type: "blank", id });
    if (offer.end < value.length) chunks.push({ type: "text", value: value.slice(offer.end) });
    const next = [...parts.slice(0, offer.partIndex), ...chunks, ...parts.slice(offer.partIndex + 1)];
    commit(next, { ...blanks, [id]: { kind: blankKindFor(answer), values: [answer], choices: [] } }, id);
    setOffer(null);
    window.getSelection()?.removeAllRanges();
  };

  return (
    <>
      <div
        ref={rootRef}
        className={`ws-blank-compose${variant === "sheet" ? " is-sheet" : ""}${parts.every((part) => part.type !== "text" || !part.value) ? " is-empty" : ""}`}
        onMouseDown={editable ? (event) => event.stopPropagation() : undefined}
      >
        {parts.map((part, index) => (part.type === "text" ? (
          <span
            key={`t-${index}`}
            data-kind="text"
            data-part={index}
            contentEditable={editable}
            suppressContentEditableWarning
            role={editable ? "textbox" : undefined}
            aria-label={editable ? "Текст с пропусками" : undefined}
            ref={(node) => {
              if (node && node.textContent !== (part.value || "")) node.textContent = part.value || "";
            }}
            onKeyDown={editable ? (event) => { if (event.key === "Enter") event.preventDefault(); } : undefined}
            onInput={editable ? (event) => setText(index, event.currentTarget.textContent || "") : undefined}
          />
        ) : (
          <button
            key={part.id}
            type="button"
            className={`ws-blank-chip${selected === part.id ? " is-on" : ""}`}
            aria-label="Пропуск"
            title={blanks[part.id]?.values?.[0] ? `Ответ: ${blanks[part.id].values[0]}` : "Пропуск"}
            onMouseDown={(event) => event.preventDefault()}
            onClick={editable ? (event) => { event.stopPropagation(); onChange(sync(task, { content: { selectedBlank: part.id } })); } : undefined}
          >{"\u00a0"}</button>
        )))}
      </div>
      {offer ? createPortal(
        <button type="button" className="ws-blank-offer" style={{ top: offer.top, left: offer.left }} onMouseDown={(event) => event.preventDefault()} onClick={makeBlank}>Добавить пропуск</button>,
        document.body,
      ) : null}
    </>
  );
}

function FillBlankEditor({ task, onChange }) {
  const parts = task.content.parts || [];
  const blanks = task.answer.blanks || {};
  const selected = task.content.selectedBlank || parts.find((part) => part.type === "blank")?.id;
  const blank = blanks[selected] || { kind: "text", values: [""], choices: [] };
  const setBlank = (patch) => onChange(sync(task, { answer: { blanks: { ...blanks, [selected]: { ...blank, ...patch } } }, content: { selectedBlank: selected } }));
  const restoreBlank = () => {
    const index = parts.findIndex((part) => part.type === "blank" && part.id === selected);
    if (index < 0) return;
    const next = [...parts];
    next.splice(index, 1, { type: "text", value: blank.values?.[0] || "" });
    const rest = { ...blanks };
    delete rest[selected];
    const merged = mergeTextParts(next);
    onChange(sync(task, {
      content: { parts: merged, selectedBlank: merged.find((part) => part.type === "blank")?.id || "" },
      answer: { blanks: rest },
    }));
  };
  return (
    <>
      <QuestionField task={task} onChange={onChange} />
      <p className="ws-section-label">Текст</p>
      <BlankSentence task={task} onChange={onChange} />
      <p className="ws-inspector__hint">Напишите текст и выделите слово, несколько слов или букву. Появится кнопка «Добавить пропуск».</p>
      {selected ? (
        <>
          <Field label="Правильный ответ"><input value={blank.values?.[0] || ""} onChange={(event) => setBlank({ values: [event.target.value, ...(blank.values || []).slice(1)] })} /></Field>
          <Field label="Тип пропуска">
            <div className="ws-type-choice ws-opt-grid">
              {[["text", "Текст"], ["number", "Число"], ["formula", "Формула"], ["choice", "Список"]].map(([id, label]) => (
                <label key={id}><input type="radio" checked={blank.kind === id} onChange={() => setBlank({ kind: id })} /> {label}</label>
              ))}
            </div>
          </Field>
          {blank.kind === "choice" ? (
            <div className="ws-type-list">
              {(blank.choices || []).map((choice, index) => (
                <input key={index} value={choice} onChange={(event) => {
                  const choices = [...(blank.choices || [])];
                  choices[index] = event.target.value;
                  setBlank({ choices });
                }} />
              ))}
              <button type="button" onClick={() => setBlank({ choices: [...(blank.choices || []), ""] })}>+ вариант списка</button>
            </div>
          ) : null}
          <button type="button" className="ws-blank-restore" onClick={restoreBlank}>Вернуть в текст</button>
        </>
      ) : null}
    </>
  );
}

function FindErrorEditor({ task, onChange }) {
  const steps = task.answer.steps || [];
  return (
    <>
      <QuestionField task={task} onChange={onChange} />
      <div className="ws-type-list">
        {steps.map((step, index) => (
          <div key={step.id} className="ws-type-row">
            <b>{index + 1}</b>
            <input value={step.text} onChange={(event) => onChange(sync(task, { answer: { steps: steps.map((item) => item.id === step.id ? { ...item, text: event.target.value } : item) } }))} />
            <label><input type="radio" checked={!!step.wrong} onChange={() => onChange(sync(task, { answer: { steps: steps.map((item) => ({ ...item, wrong: item.id === step.id })) } }))} /> ошибка</label>
          </div>
        ))}
        <button type="button" onClick={() => onChange(sync(task, { answer: { steps: [...steps, { id: uid("step"), text: "", wrong: false }] } }))}>+ шаг</button>
      </div>
      <Field label="Правильное объяснение"><textarea rows={2} value={task.answer.explanation || ""} onChange={(event) => onChange(sync(task, { answer: { explanation: event.target.value } }))} /></Field>
      <Field label="Правильное решение"><textarea rows={2} value={task.answer.correction || ""} onChange={(event) => onChange(sync(task, { answer: { correction: event.target.value } }))} /></Field>
      <div className="ws-type-choice">
        <label><input type="checkbox" checked={!!task.content.revealStep} onChange={(event) => onChange(sync(task, { content: { revealStep: event.target.checked } }))} /> Показывать ученику номер шага с ошибкой</label>
      </div>
    </>
  );
}

const CELL_KINDS = [
  ["given", "Дано", "Текст уже стоит в таблице, ученик его видит. Пишите его прямо в клетке на листе."],
  ["student", "Ответ ученика", "На листе пустая линия: ученик вписывает ответ сам. Здесь можно указать правильный ответ, на лист он не попадёт."],
  ["computed", "Вычисляемая", "Формула или выражение. Ученик видит текст, это не поле для ввода."],
  ["header", "Заголовок", "Подпись строки или столбца. Это не ответ и не задание."],
];

function resizeCells(cells, rows, cols) {
  const next = [];
  for (let index = 0; index < rows * cols; index += 1) next.push(cells[index] || { id: `c${index}`, kind: "given", value: "", correct: "" });
  return next;
}

function TableEditor({ task, onChange, focus }) {
  const rows = task.content.rows || 3;
  const cols = task.content.cols || 3;
  const cells = task.answer.cells || [];
  const index = Number.isInteger(focus?.index) ? focus.index : -1;
  const cell = index >= 0 ? (cells[index] || { kind: "given", value: "", correct: "" }) : null;
  const setSize = (nextRows, nextCols) => onChange(sync(task, { content: { rows: nextRows, cols: nextCols }, answer: { cells: resizeCells(cells, nextRows, nextCols) } }));
  const headerRow = task.content.headerRow === true;
  const headerCol = task.content.headerCol === true;
  const setHeaders = (nextRow, nextCol) => {
    const next = cells.map((item, cellIndex) => {
      const row = Math.floor(cellIndex / cols);
      const col = cellIndex % cols;
      const marked = (nextRow && row === 0) || (nextCol && col === 0);
      if (marked) return { ...item, kind: "header" };
      const wasMarked = (headerRow && row === 0) || (headerCol && col === 0);
      if (wasMarked && item.kind === "header") return { ...item, kind: "given" };
      return item;
    });
    onChange(sync(task, { content: { headerRow: nextRow, headerCol: nextCol }, answer: { cells: next } }));
  };
  const patchCell = (patch) => {
    const next = [...cells];
    next[index] = { ...cell, ...patch };
    onChange(sync(task, { answer: { cells: next } }));
  };
  return (
    <>
      <QuestionField task={task} onChange={onChange} />
      <p className="ws-section-label">Размер</p>
      <div className="ws-table-size">
        <div className="ws-table-size__row">
          <span>Строки</span>
          <button type="button" aria-label="Убрать строку" disabled={rows <= 1} onClick={() => setSize(Math.max(1, rows - 1), cols)}>−</button>
          <b>{rows}</b>
          <button type="button" aria-label="Добавить строку" onClick={() => setSize(rows + 1, cols)}>+</button>
        </div>
        <div className="ws-table-size__row">
          <span>Столбцы</span>
          <button type="button" aria-label="Убрать столбец" disabled={cols <= 1} onClick={() => setSize(rows, Math.max(1, cols - 1))}>−</button>
          <b>{cols}</b>
          <button type="button" aria-label="Добавить столбец" onClick={() => setSize(rows, cols + 1)}>+</button>
        </div>
      </div>
      <p className="ws-section-label">Заголовки</p>
      <div className="ws-type-choice">
        <label><input type="checkbox" checked={headerRow} onChange={(event) => setHeaders(event.target.checked, headerCol)} /> Первая строка — заголовки</label>
        <label><input type="checkbox" checked={headerCol} onChange={(event) => setHeaders(headerRow, event.target.checked)} /> Первый столбец — заголовки</label>
      </div>
      {cell ? (
        <>
          <p className="ws-section-label">Клетка {Math.floor(index / cols) + 1}.{index % cols + 1}</p>
          <Field label="Тип клетки">
            <div className="ws-kind-list" role="radiogroup" aria-label="Тип клетки">
              {CELL_KINDS.map(([id, label, hint]) => (
                <label key={id} title={hint}>
                  <input type="radio" name={`cell-kind-${index}`} checked={(cell.kind || "given") === id} onChange={() => patchCell({ kind: id })} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </Field>
          <p className="ws-inspector__hint">{CELL_KINDS.find(([id]) => id === (cell.kind || "given"))?.[2]}</p>
          {cell.kind === "student" ? (
            <Field label="Правильный ответ"><input value={cell.correct || ""} onChange={(event) => patchCell({ correct: event.target.value })} /></Field>
          ) : (
            <Field label={cell.kind === "computed" ? "Выражение" : "Содержимое"}><input value={cell.value || ""} onChange={(event) => patchCell({ value: event.target.value })} /></Field>
          )}
        </>
      ) : <p className="ws-inspector__hint">Выберите клетку на листе, чтобы задать её тип.</p>}
    </>
  );
}

function formatCoord(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  const rounded = Math.round(n * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function axisStep(span) {
  const size = Math.abs(Number(span)) || 1;
  if (size <= 22) return 1;
  if (size <= 32) return 2;
  if (size <= 80) return 5;
  return 10;
}

function tickValues(min, max, step) {
  const values = [];
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(step > 0)) return values;
  const start = Math.ceil((min - 1e-8) / step) * step;
  for (let value = start; value <= max + 1e-6; value += step) {
    const rounded = Math.round(value * 1000) / 1000;
    if (Math.abs(rounded) < 1e-6 || rounded < min - 1e-6 || rounded > max + 1e-6) continue;
    values.push(rounded);
    if (values.length > 24) break;
  }
  return values;
}

function coordNum(value) {
  const text = String(value ?? "").trim().replace(",", ".");
  if (!text || text === "-" || text === "." || text === "-.") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function figureCoords(object) {
  if (!object) return [];
  const pair = (x, y) => {
    const nx = coordNum(x);
    const ny = coordNum(y);
    return nx == null || ny == null ? null : [nx, ny];
  };
  if (object.kind === "segment" || object.kind === "vector") {
    const start = pair(object.x, object.y);
    const end = pair(object.x2, object.y2);
    return start && end ? [start, end] : [];
  }
  if (object.kind === "polyline" || object.kind === "polygon") {
    return (object.points || []).map((point) => pair(point.x, point.y)).filter(Boolean);
  }
  const point = pair(object.x, object.y);
  return point ? [point] : [];
}

function GraphSvg({ expression, series, viewport, points, showGraph, showPoints, showGrid = true, figures }) {
  const clipId = useId().replace(/:/g, "");
  const xMin = Number(viewport?.xMin ?? -10);
  const yMin = Number(viewport?.yMin ?? -10);
  const xMax = Number(viewport?.xMax ?? 10);
  const yMax = Number(viewport?.yMax ?? 10);
  const xRight = xMax === xMin ? xMin + 1 : xMax;
  const yTop = yMax === yMin ? yMin + 1 : yMax;
  const pad = 28;
  const xSpan = Math.max(0.5, xRight - xMin);
  const ySpan = Math.max(0.5, yTop - yMin);
  const unit = 200 / Math.max(xSpan, ySpan);
  const plotW = xSpan * unit;
  const plotH = ySpan * unit;
  const w = plotW + pad * 2;
  const h = plotH + pad * 2;
  const left = pad;
  const top = pad;
  const right = left + plotW;
  const bottom = top + plotH;
  const sx = (x) => left + ((x - xMin) / (xRight - xMin)) * plotW;
  const sy = (y) => bottom - ((y - yMin) / (yTop - yMin)) * plotH;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const yAxis = clamp(sx(0), left, right);
  const xAxis = clamp(sy(0), top, bottom);
  const originX = xMin < 0 && xRight > 0;
  const originY = yMin < 0 && yTop > 0;
  const xStep = axisStep(xRight - xMin);
  const yStep = axisStep(yTop - yMin);
  const xTicks = tickValues(xMin, xRight, xStep);
  const yTicks = tickValues(yMin, yTop, yStep);
  const exprs = (series?.length ? series : [expression]).map((item) => String(item || "").trim()).filter(Boolean);
  const paths = exprs.map((expr) => {
    if (showGraph === false) return "";
    let d = "";
    let pen = false;
    for (let i = 0; i <= 120; i += 1) {
      const x = xMin + ((xRight - xMin) * i) / 120;
      const y = evalSafe(expr, x);
      const py = y == null ? null : sy(y);
      if (py == null || !Number.isFinite(py) || py < top - 30 || py > bottom + 30) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${sx(x).toFixed(1)},${py.toFixed(1)}`;
      pen = true;
    }
    return d;
  });
  return (
    <svg className="ws-type-graph" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Координатная плоскость">
      <defs>
        <clipPath id={clipId}><rect x={left} y={top} width={plotW} height={plotH} /></clipPath>
      </defs>
      {showGrid ? xTicks.map((tick) => (
        <line key={`gx-${tick}`} className="ws-type-graph__grid" x1={sx(tick)} y1={top} x2={sx(tick)} y2={bottom} />
      )) : null}
      {showGrid ? yTicks.map((tick) => (
        <line key={`gy-${tick}`} className="ws-type-graph__grid" x1={left} y1={sy(tick)} x2={right} y2={sy(tick)} />
      )) : null}
      <line className="ws-type-graph__axis" x1={left} y1={xAxis} x2={right - 7} y2={xAxis} />
      <line className="ws-type-graph__axis" x1={yAxis} y1={bottom} x2={yAxis} y2={top + 7} />
      <polygon className="ws-type-graph__arrow" points={`${right - 8},${xAxis - 3.5} ${right},${xAxis} ${right - 8},${xAxis + 3.5}`} />
      <polygon className="ws-type-graph__arrow" points={`${yAxis - 3.5},${top + 8} ${yAxis},${top} ${yAxis + 3.5},${top + 8}`} />
      <text className="ws-type-graph__axis-name" x={right - 2} y={xAxis - 8} textAnchor="end">x</text>
      <text className="ws-type-graph__axis-name" x={yAxis + 8} y={top + 11}>y</text>
      {originX && originY ? <text className="ws-type-graph__tick-label" x={yAxis - 5} y={xAxis + 12} textAnchor="end">0</text> : null}
      {xTicks.map((tick) => (
        <g key={`xt-${tick}`}>
          <line className="ws-type-graph__tick" x1={sx(tick)} y1={xAxis - 3} x2={sx(tick)} y2={xAxis + 3} />
          {sx(tick) < right - 18 ? (
            <text className="ws-type-graph__tick-label" x={sx(tick)} y={xAxis + 14} textAnchor="middle">{formatCoord(tick)}</text>
          ) : null}
        </g>
      ))}
      {yTicks.map((tick) => (
        <g key={`yt-${tick}`}>
          <line className="ws-type-graph__tick" x1={yAxis - 3} y1={sy(tick)} x2={yAxis + 3} y2={sy(tick)} />
          {sy(tick) > top + 16 ? (
            <text className="ws-type-graph__tick-label" x={yAxis - 6} y={sy(tick) + 3} textAnchor="end">{formatCoord(tick)}</text>
          ) : null}
        </g>
      ))}
      <g clipPath={`url(#${clipId})`}>
      {paths.map((d, index) => (d ? <path key={index} className="ws-type-graph__curve" d={d} style={{ stroke: ["#2d66e8", "#2e7c5d", "#9b2c2c", "#7a4e12"][index % 4] }} /> : null))}
      </g>
      {(figures || []).map((object) => {
        const coords = figureCoords(object);
        if (!coords.length) return null;
        if ((object.kind === "polyline" || object.kind === "polygon") && coords.length < 2) return null;
        const screen = coords.map(([x, y]) => [sx(x), sy(y)]);
        const hidden = object.visibleToStudent === false;
        const label = object.label || "";
        if (object.kind === "point" || screen.length === 1) {
          const [px, py] = screen[0];
          return (
            <g key={object.id} opacity={hidden ? 0.35 : 1}>
              <circle className="is-filled" cx={px} cy={py} r="2" clipPath={`url(#${clipId})`} />
              {label ? <text className="ws-type-graph__coord" x={px + 6} y={py - 6}>{label}</text> : null}
            </g>
          );
        }
        const closed = object.kind === "polygon";
        const end = screen[screen.length - 1];
        const prev = screen[Math.max(0, screen.length - 2)];
        const angle = Math.atan2(end[1] - prev[1], end[0] - prev[0]);
        const arrowLen = 8;
        const shaftEnd = object.kind === "vector"
          ? [end[0] - arrowLen * Math.cos(angle), end[1] - arrowLen * Math.sin(angle)]
          : end;
        const drawn = object.kind === "vector" ? [...screen.slice(0, -1), shaftEnd] : screen;
        const d = `${drawn.map((point, index) => `${index ? "L" : "M"}${point[0].toFixed(1)},${point[1].toFixed(1)}`).join("")}${closed ? "Z" : ""}`;
        const arrow = object.kind === "vector" ? [
          end,
          [end[0] - arrowLen * Math.cos(angle - 0.42), end[1] - arrowLen * Math.sin(angle - 0.42)],
          [end[0] - arrowLen * Math.cos(angle + 0.42), end[1] - arrowLen * Math.sin(angle + 0.42)],
        ] : null;
        return (
          <g key={object.id} opacity={hidden ? 0.35 : 1}>
            <g clipPath={`url(#${clipId})`}>
              <path className={`ws-type-graph__figure${closed ? " is-polygon" : ""}`} d={d} />
              {arrow ? <polygon className="ws-type-graph__arrow" points={arrow.map((point) => point.map((value) => value.toFixed(1)).join(",")).join(" ")} /> : null}
              {object.kind !== "vector" ? screen.map((point, index) => <circle key={index} className="is-filled" cx={point[0]} cy={point[1]} r="2" />) : <circle className="is-filled" cx={screen[0][0]} cy={screen[0][1]} r="2" />}
            </g>
            {label ? <text className="ws-type-graph__coord" x={screen[0][0] + 6} y={screen[0][1] - 6}>{label}</text> : null}
          </g>
        );
      })}
      {showPoints ? (points || []).filter((point) => point.show !== false).map((point) => {
        const px = sx(Number(point.x));
        const py = sy(Number(point.y));
        if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
        if (px < left - 2 || px > right + 2 || py < top - 2 || py > bottom + 2) return null;
        const name = point.showLabel === false ? "" : String(point.label || "");
        const coord = `(${formatCoord(point.x)}; ${formatCoord(point.y)})`;
        const label = name ? `${name}${coord}` : coord;
        const placeLeft = px > right - 54;
        return (
          <g key={point.id}>
            <circle className={point.filled === false ? "is-open" : "is-filled"} cx={px} cy={py} r="2" />
            <text className="ws-type-graph__coord" x={placeLeft ? px - 6 : px + 6} y={py - 7} textAnchor={placeLeft ? "end" : "start"}>{label}</text>
          </g>
        );
      }) : null}
    </svg>
  );
}

function FunctionGraphEditor({ task, onChange }) {
  const points = task.answer.points || [];
  return (
    <>
      <QuestionField task={task} onChange={onChange} />
      <Field label="Функция f(x)">
        <input value={task.content.expression || ""} placeholder="x^2 - 4*x + 3" onChange={(event) => onChange(sync(task, { content: { expression: event.target.value } }))} />
      </Field>
      {(task.content.extras || []).map((extra, index) => (
        <Field key={index} label={`Функция ${index + 2}`}>
          <input value={extra} placeholder="sin(x)" onChange={(event) => {
            const extras = [...(task.content.extras || [])];
            extras[index] = event.target.value;
            onChange(sync(task, { content: { extras } }));
          }} />
        </Field>
      ))}
      <button type="button" onClick={() => onChange(sync(task, { content: { extras: [...(task.content.extras || []), ""] } }))}>+ Добавить функцию</button>
      <p className="ws-section-label">Показывать</p>
      <div className="ws-type-choice">
        {[["showFormula", "формулу"], ["showGraph", "график"], ["showPoints", "точки"], ["showPlane", "координатную плоскость"], ["showGrid", "сетку"]].map(([key, label]) => (
          <label key={key}><input type="checkbox" checked={key === "showGrid" ? task.content.showGrid !== false : (task.content[key] !== false && (key !== "showPoints" || task.content.showPoints))} onChange={(event) => onChange(sync(task, { content: { [key]: event.target.checked } }))} /> {label}</label>
        ))}
      </div>
      <GraphSvg expression={task.content.expression} series={[task.content.expression, ...(task.content.extras || [])]} viewport={task.content.viewport} points={points} showGraph={task.content.showGraph !== false} showPoints={!!task.content.showPoints} showGrid={task.content.showGrid !== false} />
      <p className="ws-section-label">Точки</p>
      <div className="ws-type-list">
        {points.map((point) => (
          <div key={point.id} className="ws-type-row">
            <input aria-label="Подпись" value={point.label} placeholder="A" onChange={(event) => onChange(sync(task, { answer: { points: points.map((item) => item.id === point.id ? { ...item, label: event.target.value } : item) } }))} />
            <input aria-label="x" value={point.x} placeholder="x" onChange={(event) => {
              const x = event.target.value;
              const y = evalSafe(task.content.expression, x);
              onChange(sync(task, { answer: { points: points.map((item) => item.id === point.id ? { ...item, x, y: y ?? item.y } : item) } }));
            }} />
            <span aria-label="y">{formatCoord(point.y)}</span>
            <label><input type="checkbox" checked={point.filled !== false} onChange={(event) => onChange(sync(task, { answer: { points: points.map((item) => item.id === point.id ? { ...item, filled: event.target.checked } : item) } }))} /> {point.filled === false ? "пустая" : "залитая"}</label>
          </div>
        ))}
        <button type="button" onClick={() => onChange(sync(task, { answer: { points: [...points, { id: uid("pt"), label: String.fromCharCode(65 + points.length), x: 0, y: evalSafe(task.content.expression, 0) ?? 0, show: true, showLabel: true }] } }))}>+ Добавить точку</button>
      </div>
      <p className="ws-section-label">Диапазон</p>
      <div className="ws-type-row">
        {[["xMin", "X от"], ["xMax", "X до"], ["yMin", "Y от"], ["yMax", "Y до"]].map(([key, label]) => (
          <input key={key} aria-label={label} placeholder={label} value={task.content.viewport?.[key] ?? 0} onChange={(event) => onChange(sync(task, { content: { viewport: { ...task.content.viewport, [key]: Number(event.target.value) } } }))} />
        ))}
      </div>
    </>
  );
}

const OBJECT_KIND_LABEL = {
  point: "Точка",
  segment: "Отрезок",
  vector: "Вектор",
  polyline: "Ломаная",
  polygon: "Многоугольник",
};

function freshObject(kind) {
  const id = uid("obj");
  if (kind === "segment" || kind === "vector") return { id, kind, label: "", x: -2, y: 0, x2: 2, y2: 1, visibleToStudent: true };
  if (kind === "polyline") return { id, kind, label: "", points: [{ x: -2, y: 0 }, { x: 0, y: 2 }, { x: 2, y: 0 }], visibleToStudent: true };
  if (kind === "polygon") return { id, kind, label: "", points: [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 0, y: 2 }], visibleToStudent: true };
  return { id, kind: "point", label: "A", x: 1, y: 1, visibleToStudent: true };
}

function CoordinateEditor({ task, onChange }) {
  const objects = task.answer.objects || [];
  const [selectedId, setSelectedId] = useState(objects[0]?.id || "");
  const activeId = objects.some((item) => item.id === selectedId) ? selectedId : (objects[0]?.id || "");
  const updateObject = (id, patch) => onChange(sync(task, {
    answer: { objects: objects.map((item) => (item.id === id ? { ...item, ...patch } : item)) },
  }));
  return (
    <>
      <QuestionField task={task} onChange={onChange} />
      <p className="ws-section-label">Объекты</p>
      <div className="ws-type-choice ws-obj-add">
        {Object.entries(OBJECT_KIND_LABEL).map(([kind, label]) => (
          <button key={kind} type="button" onClick={() => {
            const object = freshObject(kind);
            setSelectedId(object.id);
            onChange(sync(task, { answer: { objects: [...objects, object] } }));
          }}>+ {label}</button>
        ))}
      </div>
      <div className="ws-obj-list">
        {objects.map((object) => (
          <div key={object.id} className={`ws-obj${object.id === activeId ? " is-on" : ""}`}>
            <div className="ws-obj__head">
              <button type="button" onClick={() => setSelectedId(object.id)}>
                {OBJECT_KIND_LABEL[object.kind] || "Объект"}{object.label ? ` · ${object.label}` : ""}
              </button>
              <button type="button" className="ws-obj__remove" aria-label="Удалить объект" onClick={() => {
                const next = objects.filter((item) => item.id !== object.id);
                if (activeId === object.id) setSelectedId(next[0]?.id || "");
                onChange(sync(task, { answer: { objects: next } }));
              }}>×</button>
            </div>
            {object.id === activeId ? <ObjectFields object={object} onChange={(patch) => updateObject(object.id, patch)} /> : null}
          </div>
        ))}
      </div>
    </>
  );
}

function CoordPair({ x, y, onX, onY }) {
  return (
    <div className="ws-obj__pair">
      <label><span>x</span><input value={x ?? ""} inputMode="decimal" onChange={(event) => onX(event.target.value)} /></label>
      <label><span>y</span><input value={y ?? ""} inputMode="decimal" onChange={(event) => onY(event.target.value)} /></label>
    </div>
  );
}

function ObjectFields({ object, onChange }) {
  const vertices = object.points || [];
  return (
    <>
      <label className="ws-obj__name"><span>Название</span><input value={object.label || ""} placeholder="A" onChange={(event) => onChange({ label: event.target.value })} /></label>
      {object.kind === "point" ? <CoordPair x={object.x} y={object.y} onX={(x) => onChange({ x })} onY={(y) => onChange({ y })} /> : null}
      {object.kind === "segment" || object.kind === "vector" ? (
        <>
          <p className="ws-section-label">Начало</p>
          <CoordPair x={object.x} y={object.y} onX={(x) => onChange({ x })} onY={(y) => onChange({ y })} />
          <p className="ws-section-label">Конец</p>
          <CoordPair x={object.x2} y={object.y2} onX={(x2) => onChange({ x2 })} onY={(y2) => onChange({ y2 })} />
        </>
      ) : null}
      {object.kind === "polyline" || object.kind === "polygon" ? (
        <div className="ws-obj-list">
          {vertices.map((point, index) => (
            <div key={index} className="ws-obj__vertex">
              <span>{index + 1}</span>
              <label><span>x</span><input aria-label={`x ${index + 1}`} value={point.x} inputMode="decimal" onChange={(event) => onChange({ points: vertices.map((item, itemIndex) => itemIndex === index ? { ...item, x: event.target.value } : item) })} /></label>
              <label><span>y</span><input aria-label={`y ${index + 1}`} value={point.y} inputMode="decimal" onChange={(event) => onChange({ points: vertices.map((item, itemIndex) => itemIndex === index ? { ...item, y: event.target.value } : item) })} /></label>
            </div>
          ))}
          <button type="button" onClick={() => onChange({ points: [...vertices, { x: 0, y: 0 }] })}>+ Вершина</button>
        </div>
      ) : null}
      <label className="ws-obj__vis"><input type="checkbox" checked={object.visibleToStudent !== false} onChange={(event) => onChange({ visibleToStudent: event.target.checked })} /> Показывать ученику</label>
    </>
  );
}

function LatexPreview({ latex }) {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const source = String(latex || "").trim();
    node.textContent = "";
    if (!source) {
      node.textContent = "Формула появится здесь";
      return undefined;
    }
    node.innerHTML = `\\(${source}\\)`;
    const mj = window.MathJax;
    if (!mj?.typesetPromise) return undefined;
    let dead = false;
    const run = () => { if (!dead) mj.typesetPromise([node]).catch(() => {}); };
    const startup = mj.startup?.promise;
    if (startup?.then) startup.then(run).catch(run);
    else run();
    return () => { dead = true; };
  }, [latex]);
  return <div className="ws-q-preview" ref={ref} />;
}

function ExpressionEditor({ task, onChange }) {
  return (
    <>
      <QuestionField task={task} onChange={onChange} />
      <p className="ws-section-label">Формула</p>
      <Field label="LaTeX"><input value={task.content.latex || ""} spellCheck={false} onChange={(event) => onChange(sync(task, { content: { latex: event.target.value } }))} /></Field>
      <LatexPreview latex={task.content.latex} />
      <p className="ws-section-label">Ответ</p>
      <Field label="Правильный ответ"><input value={task.answer.value || ""} onChange={(event) => onChange(sync(task, { answer: { value: event.target.value } }))} /></Field>
    </>
  );
}

function moveListItem(items, from, to) {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function SortingEditor({ task, onChange }) {
  const items = task.answer.items || [];
  const [over, setOver] = useState(-1);
  return (
    <>
      <QuestionField task={task} onChange={onChange} />
      <p className="ws-section-label">Элементы</p>
      <div className="ws-type-list">
        {items.map((item, index) => (
          <div
            key={item.id}
            className={`ws-drag-row${over === index ? " is-over" : ""}`}
            onDragOver={(event) => { event.preventDefault(); setOver(index); }}
            onDrop={(event) => {
              event.preventDefault();
              const from = Number(event.dataTransfer.getData("text/plain"));
              setOver(-1);
              if (Number.isFinite(from) && from !== index) onChange(sync(task, { answer: { items: moveListItem(items, from, index) } }));
            }}
            onDragEnd={() => setOver(-1)}
          >
            <span
              className="ws-drag"
              draggable
              aria-hidden="true"
              onDragStart={(event) => {
                event.dataTransfer.setData("text/plain", String(index));
                event.dataTransfer.effectAllowed = "move";
              }}
            >☰</span>
            <input value={item.text} aria-label={`Элемент ${index + 1}`} onChange={(event) => onChange(sync(task, { answer: { items: items.map((entry) => entry.id === item.id ? { ...entry, text: event.target.value } : entry) } }))} />
            <span>
              <button type="button" className="ws-a11y-move" aria-label="Выше" disabled={index === 0} onClick={() => onChange(sync(task, { answer: { items: moveListItem(items, index, index - 1) } }))}>↑</button>
              <button type="button" className="ws-icon-btn" aria-label="Удалить элемент" onClick={() => onChange(sync(task, { answer: { items: items.filter((entry) => entry.id !== item.id) } }))}>×</button>
            </span>
          </div>
        ))}
        <button type="button" onClick={() => onChange(sync(task, { answer: { items: [...items, { id: uid("s"), text: "" }] } }))}>+ Добавить элемент</button>
      </div>
    </>
  );
}

function ClassificationEditor({ task, onChange }) {
  const categories = task.content.categories || [];
  const items = task.answer.items || [];
  return (
    <>
      <QuestionField task={task} onChange={onChange} />
      <p className="ws-section-label">Категории</p>
      {categories.map((category) => (
        <div key={category.id} className="ws-pair-row">
          <input value={category.title} aria-label="Название категории" onChange={(event) => onChange(sync(task, { content: { categories: categories.map((item) => item.id === category.id ? { ...item, title: event.target.value } : item) } }))} />
          <button type="button" className="ws-icon-btn" aria-label="Удалить категорию" onClick={() => {
            const linked = items.filter((item) => item.categoryId === category.id && (String(item.text || "").trim() || item.image));
            if (linked.length && !window.confirm("В этой категории есть элементы. Они останутся без категории. Удалить категорию?")) return;
            onChange(sync(task, {
              content: { categories: categories.filter((item) => item.id !== category.id) },
              answer: { items: items.map((item) => item.categoryId === category.id ? { ...item, categoryId: "" } : item) },
            }));
          }}>×</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange(sync(task, { content: { categories: [...categories, { id: uid("cat"), title: "Новая группа" }] } }))}>+ Добавить категорию</button>
      <p className="ws-section-label">Элементы</p>
      {items.map((item) => (
        <div key={item.id} className="ws-el-row">
          <input value={item.text || ""} aria-label="Текст элемента" placeholder="Элемент" onChange={(event) => onChange(sync(task, { answer: { items: items.map((entry) => entry.id === item.id ? { ...entry, text: event.target.value } : entry) } }))} />
          <PictureControl image={item.image} label="элемент" onChange={(image) => onChange(sync(task, { answer: { items: items.map((entry) => entry.id === item.id ? { ...entry, image } : entry) } }))} />
          <select aria-label="Категория" value={item.categoryId} onChange={(event) => onChange(sync(task, { answer: { items: items.map((entry) => entry.id === item.id ? { ...entry, categoryId: event.target.value } : entry) } }))}>
            <option value="">Без категории</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.title}</option>)}
          </select>
          <button type="button" className="ws-icon-btn" aria-label="Удалить элемент" onClick={() => onChange(sync(task, { answer: { items: items.filter((entry) => entry.id !== item.id) } }))}>×</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange(sync(task, { answer: { items: [...items, { id: uid("el"), text: "", categoryId: categories[0]?.id || "" }] } }))}>+ Добавить элемент</button>
    </>
  );
}

function TextQuestionsEditor({ task, onChange }) {
  const questions = task.answer.questions || [];
  const [over, setOver] = useState(-1);
  return (
    <>
      <QuestionField task={task} onChange={onChange} />
      <p className="ws-section-label">Исходный текст</p>
      <textarea rows={5} value={task.content.stimulus || ""} placeholder="Текст, к которому ученик вернётся при ответе" onChange={(event) => onChange(sync(task, { content: { stimulus: event.target.value } }))} />
      <p className="ws-section-label">Вопросы</p>
      {questions.map((question, index) => (
        <div
          key={question.id}
          className={`ws-drag-row${over === index ? " is-over" : ""}`}
          onDragOver={(event) => { event.preventDefault(); setOver(index); }}
          onDrop={(event) => {
            event.preventDefault();
            const from = Number(event.dataTransfer.getData("text/plain"));
            setOver(-1);
            if (Number.isFinite(from) && from !== index) onChange(sync(task, { answer: { questions: moveListItem(questions, from, index) } }));
          }}
        >
          <span className="ws-drag" draggable aria-hidden="true" onDragStart={(event) => { event.dataTransfer.setData("text/plain", String(index)); event.dataTransfer.effectAllowed = "move"; }}>☰</span>
          <div>
            <input aria-label={`Вопрос ${index + 1}`} value={question.prompt} placeholder="Вопрос" onChange={(event) => onChange(sync(task, { answer: { questions: questions.map((item) => item.id === question.id ? { ...item, prompt: event.target.value } : item) } }))} />
            <input aria-label="Правильный ответ" value={question.answer} placeholder="Правильный ответ" onChange={(event) => onChange(sync(task, { answer: { questions: questions.map((item) => item.id === question.id ? { ...item, answer: event.target.value } : item) } }))} />
          </div>
          <button type="button" className="ws-icon-btn" aria-label="Удалить вопрос" onClick={() => onChange(sync(task, { answer: { questions: questions.filter((item) => item.id !== question.id) } }))}>×</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange(sync(task, { answer: { questions: [...questions, { id: uid("sq"), prompt: "", answer: "" }] } }))}>+ Добавить вопрос</button>
    </>
  );
}

const IMAGE_TOKEN_COST = 8;

function ImageEditor({ task, onChange }) {
  const [picturePrompt, setPicturePrompt] = useState("");
  const [pictureState, setPictureState] = useState("");
  const readFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onChange(sync(task, { content: { imageUrl: String(reader.result || ""), width: task.content.width || 100 } }));
    reader.readAsDataURL(file);
  };
  const generatePicture = async () => {
    const prompt = (picturePrompt || task.question || task.q || "").trim();
    if (prompt.length < 3) {
      setPictureState("Опишите, что нарисовать.");
      return;
    }
    setPictureState("loading");
    try {
      await ensureCsrfCookie();
      const headers = {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      };
      const csrf = getCsrfToken();
      if (csrf) headers["X-CSRFToken"] = csrf;
      const response = await fetch("/api/cabinet/ai/worksheets/images/", {
        method: "POST",
        credentials: "same-origin",
        headers,
        body: JSON.stringify({ prompt }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.image) {
        throw new Error(data.message || "Не удалось нарисовать изображение.");
      }
      onChange(sync(task, { content: { imageUrl: data.image, width: task.content.width || 100 } }));
      window.dispatchEvent(new Event("itflux:ai-tokens"));
      setPictureState(`Списано ${data.charged ?? IMAGE_TOKEN_COST} токенов.`);
    } catch (error) {
      setPictureState(error.message || "Не удалось нарисовать изображение.");
    }
  };
  return (
    <>
      <p className="ws-section-label">Изображение</p>
      <Field label={task.content.imageUrl ? "Заменить" : "Файл"}>
        <input type="file" accept="image/*" onChange={(event) => readFile(event.target.files?.[0])} />
      </Field>
      <div className="ws-gen-picture">
        <label className="ws-type-field">
          <span>Что нарисовать</span>
          <textarea
            rows={3}
            value={picturePrompt}
            placeholder="Например: прямоугольный треугольник и квадрат на его гипотенузе"
            onChange={(event) => setPicturePrompt(event.target.value)}
          />
        </label>
        <button type="button" disabled={pictureState === "loading"} onClick={generatePicture}>
          {pictureState === "loading" ? "Рисуем…" : `Сгенерировать картинку · ${IMAGE_TOKEN_COST} токенов`}
        </button>
        {pictureState && pictureState !== "loading" ? <p className={pictureState.startsWith("Списано") ? "ws-hint" : "ws-hint is-error"}>{pictureState}</p> : null}
      </div>
      {task.content.imageUrl ? (
        <>
          <button type="button" onClick={() => onChange(sync(task, { content: { imageUrl: "" } }))}>Удалить изображение</button>
          <Field label="Ширина">
            <input type="range" min="40" max="100" value={task.content.width || 100} aria-valuetext={`${task.content.width || 100}%`} onChange={(event) => onChange(sync(task, { content: { width: Number(event.target.value) } }))} />
          </Field>
        </>
      ) : null}
      <p className="ws-section-label">Вопрос</p>
      <QuestionField task={task} onChange={onChange} />
      <Field label="Правильный ответ"><input value={task.answer.value || ""} onChange={(event) => onChange(sync(task, { answer: { value: event.target.value } }))} /></Field>
    </>
  );
}

const SOLID_KINDS = [
  { id: "cube", label: "Куб", fields: [{ key: "a", label: "Ребро", value: 4 }] },
  { id: "box", label: "Параллелепипед", fields: [{ key: "a", label: "Длина", value: 6 }, { key: "b", label: "Ширина", value: 4 }, { key: "c", label: "Высота", value: 3 }] },
  { id: "prism", label: "Треугольная призма", fields: [{ key: "a", label: "Сторона основания", value: 4 }, { key: "h", label: "Высота", value: 5 }] },
  { id: "hexprism", label: "Шестиугольная призма", fields: [{ key: "a", label: "Сторона", value: 3 }, { key: "h", label: "Высота", value: 5 }] },
  { id: "pyramid", label: "Пирамида", fields: [{ key: "a", label: "Сторона основания", value: 5 }, { key: "h", label: "Высота", value: 6 }] },
  { id: "tetra", label: "Тетраэдр", fields: [{ key: "a", label: "Ребро", value: 4 }] },
  { id: "frustum", label: "Усечённая пирамида", fields: [{ key: "a", label: "Нижнее основание", value: 6 }, { key: "b", label: "Верхнее основание", value: 3 }, { key: "h", label: "Высота", value: 4 }] },
  { id: "cylinder", label: "Цилиндр", fields: [{ key: "r", label: "Радиус", value: 3 }, { key: "h", label: "Высота", value: 6 }] },
  { id: "cone", label: "Конус", fields: [{ key: "r", label: "Радиус", value: 3 }, { key: "h", label: "Высота", value: 6 }] },
  { id: "frustum_cone", label: "Усечённый конус", fields: [{ key: "R", label: "Нижний радиус", value: 4 }, { key: "r", label: "Верхний радиус", value: 2 }, { key: "h", label: "Высота", value: 5 }] },
  { id: "sphere", label: "Шар", fields: [{ key: "r", label: "Радиус", value: 3 }] },
];

function solidKind(kind) {
  return SOLID_KINDS.find((item) => item.id === kind) || SOLID_KINDS[0];
}

function solidNum(figure, key, fallback) {
  const n = Number(String(figure?.[key] ?? fallback).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function solidPoint(x, y, z, ox, oy) {
  return [ox + x + y * 0.46, oy - z - y * 0.3];
}

function solidSpan(w, d, h) {
  return { width: w + d * 0.46, height: h + d * 0.3 };
}

function placeSolid(w, d, h) {
  const span = solidSpan(w, d, h);
  return { ox: (240 - span.width) / 2, oy: 18 + span.height };
}

function solidLabel(a, b, text, dx = 0, dy = 14) {
  return { x: (a[0] + b[0]) / 2 + dx, y: (a[1] + b[1]) / 2 + dy, text };
}

function boxSolid(w, d, h, labels) {
  const { ox, oy } = placeSolid(w, d, h);
  const p = (x, y, z) => solidPoint(x, y, z, ox, oy);
  const A = p(0, 0, 0);
  const B = p(w, 0, 0);
  const C = p(w, d, 0);
  const D = p(0, d, 0);
  const E = p(0, 0, h);
  const F = p(w, 0, h);
  const G = p(w, d, h);
  const H = p(0, d, h);
  return {
    faces: [
      [A, B, F, E],
      [B, C, G, F],
      [E, F, G, H],
    ],
    edges: [
      [A, B], [B, F], [F, E], [E, A], [B, C], [C, G], [G, F], [F, E], [E, H], [H, G],
    ].map(([a, b]) => ({ a, b })).concat([
      { a: A, b: D, hidden: true },
      { a: D, b: C, hidden: true },
      { a: D, b: H, hidden: true },
    ]),
    labels,
    vertices: [
      { id: "A", at: A }, { id: "B", at: B }, { id: "C", at: C }, { id: "D", at: D },
      { id: "A₁", at: E }, { id: "B₁", at: F }, { id: "C₁", at: G }, { id: "D₁", at: H },
    ],
  };
}

function ellipseArc(cx, cy, rx, ry, from, to) {
  let d = "";
  const steps = 18;
  for (let i = 0; i <= steps; i += 1) {
    const t = from + ((to - from) * i) / steps;
    const x = cx + rx * Math.cos(t);
    const y = cy + ry * Math.sin(t);
    d += `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }
  return d;
}

function solidModel(figure) {
  const kind = figure?.kind || "cube";
  const spec = solidKind(kind);
  const dim = (key) => solidNum(figure, key, spec.fields.find((item) => item.key === key)?.value ?? 1);
  const shown = (key) => {
    const field = spec.fields.find((item) => item.key === key);
    return `${key} = ${dim(key)}`;
  };
  if (kind === "cylinder" || kind === "cone" || kind === "frustum_cone" || kind === "sphere") {
    return { ...buildRound(figure), dim, shown };
  }
  if (kind === "cube") {
    const s = 68;
    const model = boxSolid(s, s, s, []);
    const [a, b] = [model.edges[0].a, model.edges[0].b];
    model.labels = [solidLabel(a, b, shown("a"), 0, 16)];
    return model;
  }
  if (kind === "box") {
    const k = 72 / Math.max(dim("a"), dim("b"), dim("c"));
    const model = boxSolid(dim("a") * k, dim("b") * k, dim("c") * k, []);
    model.labels = [
      solidLabel(model.edges[0].a, model.edges[0].b, shown("a"), 0, 16),
      solidLabel(model.edges[4].a, model.edges[4].b, shown("b"), 10, 4),
      solidLabel(model.edges[1].a, model.edges[1].b, shown("c"), 12, 0),
    ];
    return model;
  }
  if (kind === "prism") {
    const k = 64 / Math.max(dim("a"), dim("h"));
    const side = dim("a") * k;
    const tall = dim("h") * k;
    const depth = side * 0.72;
    const { ox, oy } = placeSolid(side, depth, tall);
    const p = (x, y, z) => solidPoint(x, y, z, ox, oy);
    const A = p(0, 0, 0);
    const B = p(side, 0, 0);
    const C = p(side / 2, depth, 0);
    const A2 = p(0, 0, tall);
    const B2 = p(side, 0, tall);
    const C2 = p(side / 2, depth, tall);
    return {
      faces: [[A, B, B2, A2], [B, C, C2, B2], [A2, B2, C2]],
      edges: [
        { a: A, b: B }, { a: B, b: B2 }, { a: B2, b: A2 }, { a: A2, b: A },
        { a: B, b: C }, { a: C, b: C2 }, { a: C2, b: B2 }, { a: A2, b: C2 },
        { a: A, b: C, hidden: true }, { a: C, b: C2 },
      ],
      labels: [solidLabel(A, B, shown("a"), 0, 16), solidLabel(B, B2, shown("h"), 12, 0)],
      vertices: [
        { id: "A", at: A }, { id: "B", at: B }, { id: "C", at: C },
        { id: "A₁", at: A2 }, { id: "B₁", at: B2 }, { id: "C₁", at: C2 },
      ],
    };
  }
  if (kind === "hexprism") {
    const k = 58 / Math.max(dim("a"), dim("h") * 0.7);
    const radius = dim("a") * k;
    const tall = dim("h") * k;
    const { ox, oy } = placeSolid(radius * 2, radius * 2, tall);
    const p = (i, z) => {
      const angle = -Math.PI / 2 + i * (Math.PI / 3);
      return solidPoint(radius + radius * Math.cos(angle), radius + radius * Math.sin(angle), z, ox, oy);
    };
    const bottom = [0, 1, 2, 3, 4, 5].map((i) => p(i, 0));
    const top = [0, 1, 2, 3, 4, 5].map((i) => p(i, tall));
    const edges = [];
    for (let i = 0; i < 6; i += 1) {
      const next = (i + 1) % 6;
      const back = i >= 2 && i <= 4;
      edges.push({ a: bottom[i], b: bottom[next], hidden: back });
      edges.push({ a: top[i], b: top[next] });
      edges.push({ a: bottom[i], b: top[i], hidden: i === 3 || i === 4 });
    }
    return {
      faces: [top, [bottom[0], bottom[1], top[1], top[0]], [bottom[1], bottom[2], top[2], top[1]]],
      edges,
      labels: [solidLabel(bottom[0], bottom[1], shown("a"), 0, 16), solidLabel(bottom[0], top[0], shown("h"), -16, 0)],
      vertices: [
        ...bottom.map((at, index) => ({ id: "ABCDEF"[index], at })),
        ...top.map((at, index) => ({ id: `${"ABCDEF"[index]}₁`, at })),
      ],
    };
  }
  if (kind === "pyramid" || kind === "tetra") {
    const base = kind === "tetra" ? dim("a") : dim("a");
    const height = kind === "tetra" ? dim("a") * 0.8 : dim("h");
    const k = 70 / Math.max(base, height);
    const w = base * k;
    const d = kind === "tetra" ? w * 0.86 : w * 0.72;
    const h = height * k;
    const { ox, oy } = placeSolid(w, d, h);
    const p = (x, y, z) => solidPoint(x, y, z, ox, oy);
    if (kind === "tetra") {
      const A = p(0, 0, 0);
      const B = p(w, 0, 0);
      const C = p(w / 2, d, 0);
      const S = p(w / 2, d * 0.34, h);
      return {
        faces: [[A, B, S], [B, C, S]],
        edges: [
          { a: A, b: B }, { a: B, b: S }, { a: S, b: A }, { a: B, b: C }, { a: C, b: S },
          { a: A, b: C, hidden: true },
        ],
        labels: [solidLabel(A, B, shown("a"), 0, 16)],
        vertices: [{ id: "A", at: A }, { id: "B", at: B }, { id: "C", at: C }, { id: "D", at: S }],
      };
    }
    const A = p(0, 0, 0);
    const B = p(w, 0, 0);
    const C = p(w, d, 0);
    const D = p(0, d, 0);
    const S = p(w / 2, d / 2, h);
    return {
      faces: [[A, B, S], [B, C, S]],
      edges: [
        { a: A, b: B }, { a: B, b: C }, { a: A, b: S }, { a: B, b: S }, { a: C, b: S },
        { a: A, b: D, hidden: true }, { a: D, b: C, hidden: true }, { a: D, b: S, hidden: true },
      ],
      labels: [solidLabel(A, B, shown("a"), 0, 16), solidLabel(S, S, shown("h"), 8, -8)],
      vertices: [{ id: "A", at: A }, { id: "B", at: B }, { id: "C", at: C }, { id: "D", at: D }, { id: "S", at: S }],
    };
  }
  if (kind === "frustum") {
    const k = 68 / Math.max(dim("a"), dim("h"));
    const w = dim("a") * k;
    const d = w * 0.7;
    const h = dim("h") * k;
    const topW = Math.min(w * 0.92, dim("b") * k);
    const topD = topW * 0.7;
    const ix = (w - topW) / 2;
    const iy = (d - topD) / 2;
    const { ox, oy } = placeSolid(w, d, h);
    const p = (x, y, z) => solidPoint(x, y, z, ox, oy);
    const A = p(0, 0, 0);
    const B = p(w, 0, 0);
    const C = p(w, d, 0);
    const D = p(0, d, 0);
    const E = p(ix, iy, h);
    const F = p(ix + topW, iy, h);
    const G = p(ix + topW, iy + topD, h);
    const H = p(ix, iy + topD, h);
    return {
      faces: [[A, B, F, E], [B, C, G, F], [E, F, G, H]],
      edges: [
        { a: A, b: B }, { a: B, b: C }, { a: A, b: E }, { a: B, b: F }, { a: C, b: G },
        { a: E, b: F }, { a: F, b: G }, { a: G, b: H }, { a: H, b: E },
        { a: A, b: D, hidden: true }, { a: D, b: C, hidden: true }, { a: D, b: H, hidden: true },
      ],
      labels: [
        solidLabel(A, B, shown("a"), 0, 16),
        solidLabel(E, F, shown("b"), 0, -8),
        solidLabel(B, F, shown("h"), 14, 0),
      ],
      vertices: [
        { id: "A", at: A }, { id: "B", at: B }, { id: "C", at: C }, { id: "D", at: D },
        { id: "A₁", at: E }, { id: "B₁", at: F }, { id: "C₁", at: G }, { id: "D₁", at: H },
      ],
    };
  }
  return boxSolid(68, 68, 68, []);
}

function sampleLoop(cx, cy, rx, ry, from, to, steps) {
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = from + ((to - from) * i) / steps;
    points.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  const edges = [];
  for (let i = 0; i < points.length - 1; i += 1) edges.push({ a: points[i], b: points[i + 1] });
  return edges;
}

function buildRound(figure) {
  const kind = figure?.kind || "cylinder";
  const spec = solidKind(kind);
  const dim = (key) => solidNum(figure, key, spec.fields.find((item) => item.key === key)?.value ?? 1);
  const r = dim(kind === "frustum_cone" ? "R" : "r");
  const topR = kind === "frustum_cone" ? dim("r") : r;
  const h = kind === "sphere" ? r * 2 : dim("h");
  const unit = 78 / Math.max(kind === "sphere" ? r * 2 : Math.max(r * 2, topR * 2, h), 1);
  const rx = (kind === "frustum_cone" ? dim("R") : r) * unit;
  const rx2 = topR * unit;
  const ry = Math.max(8, rx * 0.32);
  const ry2 = Math.max(6, rx2 * 0.32);
  const hh = kind === "sphere" ? rx * 2 : h * unit;
  const cx = 120;
  const baseY = kind === "sphere" ? 86 : 132;
  const topY = baseY - hh;
  const edges = [];
  const vertices = [];
  if (kind === "sphere") {
    vertices.push({ id: "O", at: [cx, baseY] }, { id: "A", at: [cx + rx, baseY] });
    edges.push(...sampleLoop(cx, baseY, rx, rx, 0, Math.PI * 2, 16));
    edges.push(...sampleLoop(cx, baseY, rx, ry, 0, Math.PI * 2, 16));
  } else if (kind === "cone") {
    const left = [cx - rx, baseY];
    const right = [cx + rx, baseY];
    const apex = [cx, topY];
    vertices.push({ id: "O", at: [cx, baseY] }, { id: "A", at: left }, { id: "B", at: right }, { id: "S", at: apex });
    edges.push({ a: left, b: apex }, { a: right, b: apex }, { a: [cx, baseY], b: apex });
    edges.push(...sampleLoop(cx, baseY, rx, ry, 0, Math.PI * 2, 16));
  } else {
    const left = [cx - rx, baseY];
    const right = [cx + rx, baseY];
    const leftTop = [cx - rx2, topY];
    const rightTop = [cx + rx2, topY];
    vertices.push(
      { id: "O", at: [cx, baseY] },
      { id: "O₁", at: [cx, topY] },
      { id: "A", at: left },
      { id: "B", at: right },
      { id: "A₁", at: leftTop },
      { id: "B₁", at: rightTop },
    );
    edges.push({ a: left, b: leftTop }, { a: right, b: rightTop }, { a: [cx, baseY], b: [cx, topY] });
    edges.push(...sampleLoop(cx, baseY, rx, ry, 0, Math.PI * 2, 16));
    edges.push(...sampleLoop(cx, topY, rx2, ry2, 0, Math.PI * 2, 16));
  }
  return { round: kind, cx, baseY, topY, rx, ry, rx2, ry2, vertices, edges };
}

function solidDragStart(event, payload) {
  event.stopPropagation();
  event.dataTransfer.setData("text/plain", payload);
  event.dataTransfer.effectAllowed = payload.startsWith("kind:") ? "copy" : "move";
}

function applySolidDrop(figures, event, index, fresh = freshSolid, allow = null) {
  const raw = event.dataTransfer.getData("text/plain") || "";
  if (raw.startsWith("kind:")) {
    const kind = raw.slice(5);
    if (allow && !allow.includes(kind)) return figures;
    const next = [...figures];
    next.splice(index, 0, fresh(kind));
    return next;
  }
  if (raw.startsWith("move:")) {
    const from = Number(raw.slice(5));
    if (!Number.isFinite(from) || from === index) return figures;
    return moveListItem(figures, from, index);
  }
  return figures;
}

function vertexName(figure, id) {
  const custom = figure?.vertexNames?.[id];
  return custom == null ? id : String(custom);
}

function outwardLabel(point, center, distance = 14) {
  const dx = point[0] - center[0];
  const dy = point[1] - center[1];
  const len = Math.hypot(dx, dy) || 1;
  return { x: point[0] + (dx / len) * distance, y: point[1] + (dy / len) * distance + 4 };
}

function markAt(edges, mark) {
  const edge = edges?.[mark.edge];
  if (!edge) return null;
  const t = Math.min(1, Math.max(0, Number(mark.t) || 0));
  return [edge.a[0] + (edge.b[0] - edge.a[0]) * t, edge.a[1] + (edge.b[1] - edge.a[1]) * t];
}

function nearestOnEdges(edges, x, y) {
  let best = null;
  (edges || []).forEach((edge, index) => {
    const dx = edge.b[0] - edge.a[0];
    const dy = edge.b[1] - edge.a[1];
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.min(1, Math.max(0, ((x - edge.a[0]) * dx + (y - edge.a[1]) * dy) / len2));
    const px = edge.a[0] + dx * t;
    const py = edge.a[1] + dy * t;
    const dist = Math.hypot(px - x, py - y);
    if (!best || dist < best.dist) best = { index, t, dist };
  });
  return best && best.dist <= 28 ? best : null;
}

function nextMarkName(figure, vertices) {
  const used = new Set([
    ...(vertices || []).map((vertex) => vertexName(figure, vertex.id)),
    ...(figure?.marks || []).map((mark) => mark.name),
  ]);
  const pool = ["M", "N", "P", "K", "Q", "T", "H", "L", "R"];
  return pool.find((name) => !used.has(name)) || `P${(figure?.marks || []).length + 1}`;
}

function makeMark(figure, model, hit) {
  const edge = hit ? hit.index : ((figure.marks || []).length % Math.max((model.edges || []).length, 1));
  const t = hit ? Math.round(hit.t * 100) / 100 : 0.5;
  return { id: uid("pt"), name: nextMarkName(figure, model.vertices), edge, t };
}

function VertexLayer({ figure, vertices, edges, compact }) {
  if (compact || !(vertices || []).length) return null;
  const cx = vertices.reduce((sum, vertex) => sum + vertex.at[0], 0) / vertices.length;
  const cy = vertices.reduce((sum, vertex) => sum + vertex.at[1], 0) / vertices.length;
  return (
    <>
      {vertices.map((vertex) => {
        const name = vertexName(figure, vertex.id);
        const pos = outwardLabel(vertex.at, [cx, cy]);
        return (
          <g key={vertex.id}>
            <circle className="is-dot" cx={vertex.at[0]} cy={vertex.at[1]} r="2.3" />
            {name ? <text className="ws-vertex" x={pos.x} y={pos.y} textAnchor="middle">{name}</text> : null}
          </g>
        );
      })}
      {(figure?.marks || []).map((mark) => {
        const at = markAt(edges, mark);
        if (!at || !mark.name) return null;
        return (
          <g key={mark.id}>
            <circle className="is-mark" cx={at[0]} cy={at[1]} r="3.1" />
            <text className="ws-vertex" x={at[0] + 9} y={at[1] - 7} textAnchor="start">{mark.name}</text>
          </g>
        );
      })}
    </>
  );
}

function FigurePointFields({ figure, model, onPatch }) {
  const vertices = model.vertices || [];
  const edges = model.edges || [];
  return (
    <>
      {vertices.length ? (
        <div className="ws-verts">
          <span>Вершины</span>
          {vertices.map((vertex) => (
            <label key={vertex.id}>
              <input
                value={vertexName(figure, vertex.id)}
                aria-label={`Вершина ${vertex.id}`}
                onChange={(event) => onPatch({ vertexNames: { ...(figure.vertexNames || {}), [vertex.id]: event.target.value } })}
              />
            </label>
          ))}
        </div>
      ) : null}
      {(figure.marks || []).map((mark) => (
        <div key={mark.id} className="ws-mark-row">
          <label><span>Точка</span>
            <input value={mark.name} aria-label="Имя точки" onChange={(event) => onPatch({ marks: figure.marks.map((item) => item.id === mark.id ? { ...item, name: event.target.value } : item) })} />
          </label>
          <button type="button" className="ws-obj__remove" aria-label="Удалить точку" onClick={() => onPatch({ marks: figure.marks.filter((item) => item.id !== mark.id) })}>×</button>
        </div>
      ))}
      {edges.length ? (
        <button type="button" onClick={() => onPatch({ marks: [...(figure.marks || []), makeMark(figure, model)] })}>Поставить точку</button>
      ) : null}
    </>
  );
}

function SolidSvg({ figure, compact = false, onPick }) {
  const model = solidModel(figure);
  const spec = solidKind(figure?.kind);
  const pick = onPick ? (event) => { event.stopPropagation(); onPick(event.currentTarget, event); } : undefined;
  if (model.round) {
    const kind = model.round;
    const { cx, baseY, topY, rx, ry, rx2, ry2 } = model;
    return (
      <svg className={`ws-solid${onPick ? " is-pick" : ""}`} viewBox="0 0 240 168" role="img" aria-label={spec.label} onClick={pick}>
        {kind === "sphere" ? (
          <>
            <circle cx={cx} cy={baseY} r={rx} />
            <path d={ellipseArc(cx, baseY, rx, ry, 0, Math.PI)} />
            <path className="is-hidden" d={ellipseArc(cx, baseY, rx, ry, Math.PI, Math.PI * 2)} />
            {compact ? null : <text x={cx + rx + 8} y={baseY}>{model.shown("r")}</text>}
          </>
        ) : (
          <>
            <path className="ws-solid__face" d={kind === "cone"
              ? `${ellipseArc(cx, baseY, rx, ry, 0, Math.PI)} L${cx.toFixed(1)},${topY.toFixed(1)} Z`
              : `${ellipseArc(cx, baseY, rx, ry, 0, Math.PI)} L${(cx - rx2).toFixed(1)},${topY.toFixed(1)} L${(cx + rx2).toFixed(1)},${topY.toFixed(1)} Z`} />
            <path d={ellipseArc(cx, baseY, rx, ry, 0, Math.PI)} />
            <path className="is-hidden" d={ellipseArc(cx, baseY, rx, ry, Math.PI, Math.PI * 2)} />
            {kind === "cone" ? (
              <>
                <line x1={cx - rx} y1={baseY} x2={cx} y2={topY} />
                <line x1={cx + rx} y1={baseY} x2={cx} y2={topY} />
              </>
            ) : (
              <>
                <ellipse cx={cx} cy={topY} rx={rx2} ry={ry2} />
                <line x1={cx - rx} y1={baseY} x2={cx - rx2} y2={topY} />
                <line x1={cx + rx} y1={baseY} x2={cx + rx2} y2={topY} />
              </>
            )}
            {compact ? null : <text x={cx} y={baseY + ry + 14} textAnchor="middle">{model.shown(kind === "frustum_cone" ? "R" : "r")}</text>}
            {!compact && kind === "frustum_cone" ? <text x={cx} y={topY - ry2 - 4} textAnchor="middle">{model.shown("r")}</text> : null}
            {compact ? null : <text x={cx + rx + 8} y={(baseY + topY) / 2}>{model.shown("h")}</text>}
          </>
        )}
        <VertexLayer figure={figure} vertices={model.vertices} edges={model.edges} compact={compact} />
      </svg>
    );
  }
  const tones = ["", " is-side", " is-top"];
  return (
    <svg className={`ws-solid${onPick ? " is-pick" : ""}`} viewBox="0 0 240 168" role="img" aria-label={spec.label} onClick={pick}>
      {model.faces.map((points, index) => (
        <polygon key={`f-${index}`} className={`ws-solid__face${tones[index] || ""}`} points={points.map((point) => point.map((value) => value.toFixed(1)).join(",")).join(" ")} />
      ))}
      {model.edges.map((edge, index) => (
        <line key={`e-${index}`} className={edge.hidden ? "is-hidden" : ""} x1={edge.a[0]} y1={edge.a[1]} x2={edge.b[0]} y2={edge.b[1]} />
      ))}
      {(compact ? [] : model.labels || []).map((label) => (
        <text key={label.text} x={label.x} y={label.y} textAnchor="middle">{label.text}</text>
      ))}
      <VertexLayer figure={figure} vertices={model.vertices} edges={model.edges} compact={compact} />
    </svg>
  );
}

function freshSolid(kind) {
  const spec = solidKind(kind);
  return { id: uid("solid"), kind: spec.id, ...Object.fromEntries(spec.fields.map((field) => [field.key, field.value])) };
}

function previewSolid(kind) {
  const figure = freshSolid(kind);
  return { ...figure, id: kind };
}

function SolidSheet({ figures, arrange, onReorder, onMark, draw, title }) {
  const dragged = useRef(false);
  const paint = draw || ((figure, onPick) => <SolidSvg figure={figure} onPick={onPick} />);
  const caption = title || ((figure) => solidKind(figure.kind).label);
  const [over, setOver] = useState(-1);
  const take = (event, index) => {
    event.preventDefault();
    event.stopPropagation();
    setOver(-1);
    onReorder?.(event, index);
  };
  return (
    <div
      className={`ws-solids${arrange ? " is-arrange" : ""}`}
      onDragOver={arrange ? (event) => event.preventDefault() : undefined}
      onDrop={arrange ? (event) => take(event, figures.length) : undefined}
    >
      {figures.length ? figures.map((figure, index) => (
        <div
          key={figure.id}
          className={`ws-solid-slot${over === index ? " is-over" : ""}`}
          role={arrange ? "group" : undefined}
          aria-label={arrange ? caption(figure) : undefined}
          draggable={arrange || undefined}
          onDragStart={arrange ? (event) => { dragged.current = true; solidDragStart(event, `move:${index}`); } : undefined}
          onDragOver={arrange ? (event) => { event.preventDefault(); event.stopPropagation(); setOver(index); } : undefined}
          onDrop={arrange ? (event) => take(event, index) : undefined}
          onDragEnd={() => { setOver(-1); window.setTimeout(() => { dragged.current = false; }, 0); }}
        >
          {paint(figure, arrange && onMark ? (svg, event) => {
            if (dragged.current) return;
            const rect = svg.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            onMark(figure, ((event.clientX - rect.left) / rect.width) * 240, ((event.clientY - rect.top) / rect.height) * 168);
          } : undefined)}
        </div>
      )) : <p className="ws-placeholder">{arrange ? "Перетащите фигуру сюда" : "Добавьте фигуру"}</p>}
    </div>
  );
}

function SolidEditor({ task, onChange }) {
  const figures = task.content.figures || [];
  const [selectedId, setSelectedId] = useState(figures[0]?.id || "");
  const [over, setOver] = useState(-1);
  const dragged = useRef(false);
  const activeId = figures.some((item) => item.id === selectedId) ? selectedId : (figures[0]?.id || "");
  const setFigures = (next) => onChange(sync(task, { content: { figures: next } }));
  const patch = (id, fields) => setFigures(figures.map((item) => (item.id === id ? { ...item, ...fields } : item)));
  const place = (event, index) => {
    event.preventDefault();
    setOver(-1);
    const next = applySolidDrop(figures, event, index, freshSolid, SOLID_KINDS.map((item) => item.id));
    if (next !== figures) setFigures(next);
  };
  return (
    <>
      <QuestionField task={task} onChange={onChange} />
      <p className="ws-section-label">Фигуры</p>
      <p className="ws-hint">Перетащите рисунок на лист. Вершины подписаны сами, клик по чертежу ставит точку.</p>
      <div className="ws-solid-palette">
        {SOLID_KINDS.map((item) => (
          <button
            key={item.id}
            type="button"
            className="ws-solid-palette__item"
            draggable
            aria-label={`Перетащить: ${item.label}`}
            onDragStart={(event) => { dragged.current = true; solidDragStart(event, `kind:${item.id}`); }}
            onDragEnd={() => { window.setTimeout(() => { dragged.current = false; }, 0); }}
            onClick={() => {
              if (dragged.current) return;
              const figure = freshSolid(item.id);
              setSelectedId(figure.id);
              setFigures([...figures, figure]);
            }}
          >
            <SolidSvg figure={previewSolid(item.id)} compact />
            <span>{item.label}</span>
          </button>
        ))}
      </div>
      <div className="ws-obj-list" onDragOver={(event) => event.preventDefault()} onDrop={(event) => place(event, figures.length)}>
        {figures.map((figure, index) => {
          const spec = solidKind(figure.kind);
          return (
            <div
              key={figure.id}
              className={`ws-obj${figure.id === activeId ? " is-on" : ""}${over === index ? " is-over" : ""}`}
              onDragOver={(event) => { event.preventDefault(); setOver(index); }}
              onDrop={(event) => { event.stopPropagation(); place(event, index); }}
            >
              <div className="ws-obj__head">
                <span
                  className="ws-solid-drag"
                  draggable
                  title="Перетащите фигуру"
                  onDragStart={(event) => solidDragStart(event, `move:${index}`)}
                  onDragEnd={() => setOver(-1)}
                >
                  <SolidSvg figure={figure} compact />
                </span>
                <button type="button" onClick={() => setSelectedId(figure.id)}>{spec.label}</button>
                <button type="button" className="ws-obj__remove" aria-label="Удалить фигуру" onClick={() => {
                  const next = figures.filter((item) => item.id !== figure.id);
                  if (activeId === figure.id) setSelectedId(next[0]?.id || "");
                  setFigures(next);
                }}>×</button>
              </div>
              {figure.id === activeId ? (
                <div className="ws-obj__pair">
                  {spec.fields.map((field) => (
                    <label key={field.key}><span>{field.label}</span>
                      <input value={figure[field.key] ?? ""} inputMode="decimal" onChange={(event) => patch(figure.id, { [field.key]: event.target.value })} />
                    </label>
                  ))}
                  <FigurePointFields figure={figure} model={solidModel(figure)} onPatch={(fields) => patch(figure.id, fields)} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <Field label="Правильный ответ"><input value={task.answer.value || ""} onChange={(event) => onChange(sync(task, { answer: { value: event.target.value } }))} /></Field>
    </>
  );
}

const PLANE_KINDS = [
  { id: "triangle", label: "Треугольник", fields: [{ key: "a", label: "Основание", value: 6 }, { key: "h", label: "Высота", value: 4 }] },
  { id: "right", label: "Прямоугольный треугольник", fields: [{ key: "a", label: "Катет", value: 6 }, { key: "b", label: "Катет", value: 4 }] },
  { id: "isosceles", label: "Равнобедренный треугольник", fields: [{ key: "a", label: "Основание", value: 6 }, { key: "b", label: "Боковая сторона", value: 5 }] },
  { id: "equilateral", label: "Равносторонний треугольник", fields: [{ key: "a", label: "Сторона", value: 5 }] },
  { id: "square", label: "Квадрат", fields: [{ key: "a", label: "Сторона", value: 4 }] },
  { id: "rect", label: "Прямоугольник", fields: [{ key: "a", label: "Длина", value: 6 }, { key: "b", label: "Ширина", value: 4 }] },
  { id: "parallelogram", label: "Параллелограмм", fields: [{ key: "a", label: "Основание", value: 6 }, { key: "b", label: "Сторона", value: 4 }, { key: "h", label: "Высота", value: 3 }] },
  { id: "rhombus", label: "Ромб", fields: [{ key: "d1", label: "Диагональ", value: 8 }, { key: "d2", label: "Диагональ", value: 5 }] },
  { id: "trapezoid", label: "Трапеция", fields: [{ key: "a", label: "Нижнее основание", value: 8 }, { key: "b", label: "Верхнее основание", value: 4 }, { key: "h", label: "Высота", value: 3 }] },
  { id: "isotrapezoid", label: "Равнобедренная трапеция", fields: [{ key: "a", label: "Нижнее основание", value: 8 }, { key: "b", label: "Верхнее основание", value: 4 }, { key: "h", label: "Высота", value: 3 }] },
  { id: "circle", label: "Окружность", fields: [{ key: "r", label: "Радиус", value: 3 }] },
  { id: "sector", label: "Сектор", fields: [{ key: "r", label: "Радиус", value: 4 }, { key: "a", label: "Угол, °", value: 60 }] },
  { id: "pentagon", label: "Правильный пятиугольник", fields: [{ key: "a", label: "Сторона", value: 3 }] },
  { id: "hexagon", label: "Правильный шестиугольник", fields: [{ key: "a", label: "Сторона", value: 3 }] },
  { id: "angle", label: "Угол", fields: [{ key: "a", label: "Градусы", value: 50 }] },
];

function planeKind(kind) {
  return PLANE_KINDS.find((item) => item.id === kind) || PLANE_KINDS[0];
}

function planeDim(figure, key) {
  const field = planeKind(figure?.kind).fields.find((item) => item.key === key);
  return solidNum(figure, key, field?.value ?? 1);
}

function planeText(kind, key, value) {
  if (key === "a" && (kind === "angle" || kind === "sector")) return `α = ${value}°`;
  if (key === "d1") return `d₁ = ${value}`;
  if (key === "d2") return `d₂ = ${value}`;
  return `${key} = ${value}`;
}

function edgeLabel(a, b, text, dx = 0, dy = 14) {
  return { x: (a[0] + b[0]) / 2 + dx, y: (a[1] + b[1]) / 2 + dy, text };
}

function unitToward(from, to) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  return [dx / len, dy / len];
}

function rightMark(corner, towardA, towardB) {
  const u = unitToward(corner, towardA);
  const v = unitToward(corner, towardB);
  const size = 11;
  const p1 = [corner[0] + u[0] * size, corner[1] + u[1] * size];
  const p2 = [p1[0] + v[0] * size, p1[1] + v[1] * size];
  const p3 = [corner[0] + v[0] * size, corner[1] + v[1] * size];
  return [{ a: p1, b: p2 }, { a: p2, b: p3 }];
}

function sideTicks(a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  const cx = (a[0] + b[0]) / 2;
  const cy = (a[1] + b[1]) / 2;
  return [{ a: [cx + px * 5, cy + py * 5], b: [cx - px * 5, cy - py * 5] }];
}

function planeMap(w, h) {
  const k = Math.min(150 / Math.max(w, 0.1), 96 / Math.max(h, 0.1));
  const ox = 120 - (w * k) / 2;
  const oy = 132;
  return (x, y) => [ox + x * k, oy - y * k];
}

function polarPoint(center, radius, deg) {
  const t = (deg * Math.PI) / 180;
  return [center[0] + radius * Math.cos(t), center[1] - radius * Math.sin(t)];
}

function sweepPath(center, radius, deg0, deg1, pie) {
  const steps = 18;
  const points = [];
  for (let i = 0; i <= steps; i += 1) points.push(polarPoint(center, radius, deg0 + ((deg1 - deg0) * i) / steps));
  const arc = points.map((point, index) => `${index ? "L" : "M"}${point[0].toFixed(1)},${point[1].toFixed(1)}`).join("");
  if (!pie) return arc;
  return `M${center[0].toFixed(1)},${center[1].toFixed(1)}L${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}${points.slice(1).map((point) => `L${point[0].toFixed(1)},${point[1].toFixed(1)}`).join("")}Z`;
}

function regularPoints(n, side) {
  const radius = side / (2 * Math.sin(Math.PI / n));
  const place = planeMap(radius * 2, radius * 2);
  const points = [];
  for (let i = 0; i < n; i += 1) {
    const t = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    points.push(place(radius + radius * Math.cos(t), radius + radius * Math.sin(t)));
  }
  let edge = 0;
  let low = -Infinity;
  for (let i = 0; i < n; i += 1) {
    const y = (points[i][1] + points[(i + 1) % n][1]) / 2;
    if (y > low) { low = y; edge = i; }
  }
  return { points, edge };
}

function polyCycle(points) {
  return points.map((point, index) => ({ a: point, b: points[(index + 1) % points.length] }));
}

function arcSamples(center, radius, deg0, deg1, steps = 12) {
  const edges = [];
  let prev = polarPoint(center, radius, deg0);
  for (let i = 1; i <= steps; i += 1) {
    const next = polarPoint(center, radius, deg0 + ((deg1 - deg0) * i) / steps);
    edges.push({ a: prev, b: next });
    prev = next;
  }
  return edges;
}

function frameModel(model) {
  const edges = [...(model.edges || [])];
  (model.polys || []).forEach((poly) => edges.push(...polyCycle(poly)));
  (model.lines || []).forEach((line) => {
    if (line.hidden) edges.push({ a: line.a, b: line.b });
  });
  return { ...model, edges };
}

function planeModel(figure) {
  return frameModel(planeShape(figure));
}

function planeShape(figure) {
  const kind = figure?.kind || "triangle";
  const dim = (key) => planeDim(figure, key);
  const text = (key) => planeText(kind, key, dim(key));
  if (kind === "triangle") {
    const a = dim("a");
    const h = dim("h");
    const p = planeMap(a, h);
    const A = p(0, 0);
    const B = p(a, 0);
    const C = p(a * 0.35, h);
    const F = p(a * 0.35, 0);
    return { polys: [[A, B, C]], lines: [{ a: C, b: F, hidden: true }], labels: [edgeLabel(A, B, text("a"), 0, 16), edgeLabel(C, F, text("h"), 14, 0)], vertices: [{ id: "A", at: A }, { id: "B", at: B }, { id: "C", at: C }] };
  }
  if (kind === "right") {
    const a = dim("a");
    const b = dim("b");
    const p = planeMap(a, b);
    const A = p(0, 0);
    const B = p(a, 0);
    const C = p(0, b);
    return { polys: [[A, B, C]], lines: rightMark(A, B, C), labels: [edgeLabel(A, B, text("a"), 0, 16), edgeLabel(A, C, text("b"), -16, 0)], vertices: [{ id: "A", at: A }, { id: "B", at: B }, { id: "C", at: C }] };
  }
  if (kind === "isosceles" || kind === "equilateral") {
    const a = dim("a");
    const side = kind === "equilateral" ? a : Math.max(dim("b"), a / 2 + 0.4);
    const h = kind === "equilateral" ? a * Math.sqrt(3) / 2 : Math.sqrt(Math.max(side * side - (a / 2) * (a / 2), 0.25));
    const p = planeMap(a, h);
    const A = p(0, 0);
    const B = p(a, 0);
    const C = p(a / 2, h);
    const lines = [...sideTicks(A, C), ...sideTicks(B, C)];
    if (kind === "equilateral") lines.push(...sideTicks(A, B));
    const labels = [edgeLabel(A, B, text("a"), 0, 16)];
    if (kind === "isosceles") labels.push(edgeLabel(A, C, text("b"), -16, -4));
    return { polys: [[A, B, C]], lines, labels, vertices: [{ id: "A", at: A }, { id: "B", at: B }, { id: "C", at: C }] };
  }
  if (kind === "square" || kind === "rect") {
    const a = dim("a");
    const b = kind === "square" ? a : dim("b");
    const p = planeMap(a, b);
    const A = p(0, 0);
    const B = p(a, 0);
    const C = p(a, b);
    const D = p(0, b);
    const labels = [edgeLabel(A, B, text("a"), 0, 16)];
    if (kind === "rect") labels.push(edgeLabel(B, C, text("b"), 16, 0));
    return { polys: [[A, B, C, D]], lines: rightMark(A, B, D), labels, vertices: [{ id: "A", at: A }, { id: "B", at: B }, { id: "C", at: C }, { id: "D", at: D }] };
  }
  if (kind === "parallelogram") {
    const a = dim("a");
    const b = dim("b");
    const h = dim("h");
    const dx = h < b ? Math.sqrt(Math.max(b * b - h * h, 0)) : b * 0.45;
    const tall = h < b ? h : b * 0.72;
    const p = planeMap(a + dx, tall);
    const A = p(dx, 0);
    const B = p(dx + a, 0);
    const C = p(a, tall);
    const D = p(0, tall);
    const foot = p(dx, tall);
    return {
      polys: [[A, B, C, D]],
      lines: [{ a: A, b: foot, hidden: true }],
      labels: [edgeLabel(A, B, text("a"), 0, 16), edgeLabel(A, D, text("b"), -14, 0), edgeLabel(A, foot, text("h"), 14, 0)],
      vertices: [{ id: "A", at: A }, { id: "B", at: B }, { id: "C", at: C }, { id: "D", at: D }],
    };
  }
  if (kind === "rhombus") {
    const d1 = dim("d1");
    const d2 = dim("d2");
    const p = planeMap(d1, d2);
    const L = p(0, d2 / 2);
    const R = p(d1, d2 / 2);
    const T = p(d1 / 2, d2);
    const B = p(d1 / 2, 0);
    return {
      polys: [[L, T, R, B]],
      lines: [{ a: L, b: R, hidden: true }, { a: B, b: T, hidden: true }, ...sideTicks(L, T), ...sideTicks(T, R), ...sideTicks(R, B), ...sideTicks(B, L)],
      labels: [edgeLabel(L, R, text("d1"), 0, 16), { x: T[0], y: T[1] - 8, text: text("d2") }],
      vertices: [{ id: "A", at: L }, { id: "B", at: T }, { id: "C", at: R }, { id: "D", at: B }],
    };
  }
  if (kind === "trapezoid" || kind === "isotrapezoid") {
    const a = dim("a");
    const top = Math.min(dim("b"), a * 0.92);
    const h = dim("h");
    const inset = kind === "isotrapezoid" ? Math.max(0, (a - top) / 2) : Math.max(a * 0.16, (a - top) * 0.28);
    const p = planeMap(a, h);
    const A = p(0, 0);
    const B = p(a, 0);
    const C = p(inset + top, h);
    const D = p(inset, h);
    const foot = p(inset, 0);
    const lines = [{ a: D, b: foot, hidden: true }];
    if (kind === "isotrapezoid") lines.push(...sideTicks(A, D), ...sideTicks(B, C));
    return {
      polys: [[A, B, C, D]],
      lines,
      labels: [edgeLabel(A, B, text("a"), 0, 16), edgeLabel(D, C, text("b"), 0, -12), edgeLabel(D, foot, text("h"), -16, 0)],
      vertices: [{ id: "A", at: A }, { id: "B", at: B }, { id: "C", at: C }, { id: "D", at: D }],
    };
  }
  if (kind === "circle") {
    const center = [120, 84];
    const radius = 52;
    const rim = [center[0] + radius, center[1]];
    return {
      circles: [{ c: center, r: radius }],
      lines: [{ a: center, b: rim }],
      labels: [{ x: center[0] + radius / 2, y: center[1] - 8, text: text("r") }],
      vertices: [{ id: "O", at: center }, { id: "A", at: rim }],
      edges: [{ a: center, b: rim }, ...arcSamples(center, radius, 0, 360, 16)],
    };
  }
  if (kind === "sector") {
    const alpha = Math.min(300, Math.max(15, dim("a")));
    const center = [108, 118];
    const radius = 62;
    const start = 18;
    const A = polarPoint(center, radius, start);
    const B = polarPoint(center, radius, start + alpha);
    return {
      paths: [{ d: sweepPath(center, radius, start, start + alpha, true), face: true }, { d: sweepPath(center, radius, start, start + alpha, false) }],
      lines: [{ a: center, b: A }, { a: center, b: B }],
      labels: [edgeLabel(center, A, text("r"), 0, 14), { x: polarPoint(center, 36, start + alpha / 2)[0], y: polarPoint(center, 36, start + alpha / 2)[1], text: text("a") }],
      vertices: [{ id: "O", at: center }, { id: "A", at: A }, { id: "B", at: B }],
      edges: [{ a: center, b: A }, { a: center, b: B }, ...arcSamples(center, radius, start, start + alpha, 10)],
    };
  }
  if (kind === "pentagon" || kind === "hexagon") {
    const shape = regularPoints(kind === "pentagon" ? 5 : 6, dim("a"));
    const next = (shape.edge + 1) % shape.points.length;
    const letters = "ABCDEF";
    return {
      polys: [shape.points],
      labels: [edgeLabel(shape.points[shape.edge], shape.points[next], text("a"), 0, 16)],
      vertices: shape.points.map((at, index) => ({ id: letters[index], at })),
    };
  }
  const alpha = Math.min(160, Math.max(15, dim("a")));
  const corner = [78, 128];
  const arm = 108;
  const rayB = polarPoint(corner, arm, 0);
  const rayC = polarPoint(corner, arm, alpha);
  return {
    lines: [{ a: corner, b: rayB }, { a: corner, b: rayC }],
    paths: [{ d: sweepPath(corner, 34, 0, alpha, false) }],
    labels: [{ x: polarPoint(corner, 50, alpha / 2)[0], y: polarPoint(corner, 50, alpha / 2)[1], text: text("a") }],
    vertices: [{ id: "A", at: corner }, { id: "B", at: rayB }, { id: "C", at: rayC }],
    edges: [{ a: corner, b: rayB }, { a: corner, b: rayC }],
  };
}

function PlaneSvg({ figure, compact = false, onPick }) {
  const spec = planeKind(figure?.kind);
  const model = planeModel(figure);
  const pick = onPick ? (event) => { event.stopPropagation(); onPick(event.currentTarget, event); } : undefined;
  return (
    <svg className={`ws-solid ws-plane${onPick ? " is-pick" : ""}`} viewBox="0 0 240 168" role="img" aria-label={spec.label} onClick={pick}>
      {(model.polys || []).map((points, index) => (
        <polygon key={`p-${index}`} className="ws-solid__face" points={points.map((point) => point.map((value) => value.toFixed(1)).join(",")).join(" ")} />
      ))}
      {(model.paths || []).map((path, index) => (
        <path key={`d-${index}`} className={path.face ? "ws-solid__face" : ""} d={path.d} />
      ))}
      {(model.circles || []).map((circle, index) => (
        <circle key={`c-${index}`} cx={circle.c[0]} cy={circle.c[1]} r={circle.r} />
      ))}
      {(model.dots || []).map((dot, index) => (
        <circle key={`o-${index}`} className="is-dot" cx={dot[0]} cy={dot[1]} r="2.4" />
      ))}
      {(model.lines || []).map((line, index) => (
        <line key={`l-${index}`} className={line.hidden ? "is-hidden" : ""} x1={line.a[0]} y1={line.a[1]} x2={line.b[0]} y2={line.b[1]} />
      ))}
      {compact ? null : (model.labels || []).map((label) => (
        <text key={label.text} x={label.x} y={label.y} textAnchor="middle">{label.text}</text>
      ))}
      <VertexLayer figure={figure} vertices={model.vertices} edges={model.edges} compact={compact} />
    </svg>
  );
}

function freshPlane(kind) {
  const spec = planeKind(kind);
  return { id: uid("plane"), kind: spec.id, ...Object.fromEntries(spec.fields.map((field) => [field.key, field.value])) };
}

function PlaneEditor({ task, onChange }) {
  const figures = task.content.figures || [];
  const allow = PLANE_KINDS.map((item) => item.id);
  const [selectedId, setSelectedId] = useState(figures[0]?.id || "");
  const [over, setOver] = useState(-1);
  const dragged = useRef(false);
  const activeId = figures.some((item) => item.id === selectedId) ? selectedId : (figures[0]?.id || "");
  const setFigures = (next) => onChange(sync(task, { content: { figures: next } }));
  const patch = (id, fields) => setFigures(figures.map((item) => (item.id === id ? { ...item, ...fields } : item)));
  const place = (event, index) => {
    event.preventDefault();
    setOver(-1);
    const next = applySolidDrop(figures, event, index, freshPlane, allow);
    if (next !== figures) setFigures(next);
  };
  return (
    <>
      <QuestionField task={task} onChange={onChange} />
      <p className="ws-section-label">Фигуры</p>
      <p className="ws-hint">Перетащите рисунок на лист. Вершины подписаны сами, клик по чертежу ставит точку.</p>
      <div className="ws-solid-palette">
        {PLANE_KINDS.map((item) => (
          <button
            key={item.id}
            type="button"
            className="ws-solid-palette__item"
            draggable
            aria-label={`Перетащить: ${item.label}`}
            onDragStart={(event) => { dragged.current = true; solidDragStart(event, `kind:${item.id}`); }}
            onDragEnd={() => { window.setTimeout(() => { dragged.current = false; }, 0); }}
            onClick={() => {
              if (dragged.current) return;
              const figure = freshPlane(item.id);
              setSelectedId(figure.id);
              setFigures([...figures, figure]);
            }}
          >
            <PlaneSvg figure={{ ...freshPlane(item.id), id: item.id }} compact />
            <span>{item.label}</span>
          </button>
        ))}
      </div>
      <div className="ws-obj-list" onDragOver={(event) => event.preventDefault()} onDrop={(event) => place(event, figures.length)}>
        {figures.map((figure, index) => {
          const spec = planeKind(figure.kind);
          return (
            <div
              key={figure.id}
              className={`ws-obj${figure.id === activeId ? " is-on" : ""}${over === index ? " is-over" : ""}`}
              onDragOver={(event) => { event.preventDefault(); setOver(index); }}
              onDrop={(event) => { event.stopPropagation(); place(event, index); }}
            >
              <div className="ws-obj__head">
                <span className="ws-solid-drag" draggable title="Перетащите фигуру" onDragStart={(event) => solidDragStart(event, `move:${index}`)} onDragEnd={() => setOver(-1)}>
                  <PlaneSvg figure={figure} compact />
                </span>
                <button type="button" onClick={() => setSelectedId(figure.id)}>{spec.label}</button>
                <button type="button" className="ws-obj__remove" aria-label="Удалить фигуру" onClick={() => {
                  const next = figures.filter((item) => item.id !== figure.id);
                  if (activeId === figure.id) setSelectedId(next[0]?.id || "");
                  setFigures(next);
                }}>×</button>
              </div>
              {figure.id === activeId ? (
                <div className="ws-obj__pair">
                  {spec.fields.map((field) => (
                    <label key={field.key}><span>{field.label}</span>
                      <input value={figure[field.key] ?? ""} inputMode="decimal" onChange={(event) => patch(figure.id, { [field.key]: event.target.value })} />
                    </label>
                  ))}
                  <FigurePointFields figure={figure} model={planeModel(figure)} onPatch={(fields) => patch(figure.id, fields)} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <Field label="Правильный ответ"><input value={task.answer.value || ""} onChange={(event) => onChange(sync(task, { answer: { value: event.target.value } }))} /></Field>
    </>
  );
}

const UNIT_ANGLES = [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330];
const UNIT_RAD = {
  0: "0", 30: "π/6", 45: "π/4", 60: "π/3", 90: "π/2", 120: "2π/3", 135: "3π/4", 150: "5π/6",
  180: "π", 210: "7π/6", 225: "5π/4", 240: "4π/3", 270: "3π/2", 300: "5π/3", 315: "7π/4", 330: "11π/6",
};
const UNIT_VALUE = {
  0: { cos: "1", sin: "0", tg: "0", ctg: null },
  30: { cos: "√3/2", sin: "1/2", tg: "√3/3", ctg: "√3" },
  45: { cos: "√2/2", sin: "√2/2", tg: "1", ctg: "1" },
  60: { cos: "1/2", sin: "√3/2", tg: "√3", ctg: "√3/3" },
  90: { cos: "0", sin: "1", tg: null, ctg: "0" },
  120: { cos: "−1/2", sin: "√3/2", tg: "−√3", ctg: "−√3/3" },
  135: { cos: "−√2/2", sin: "√2/2", tg: "−1", ctg: "−1" },
  150: { cos: "−√3/2", sin: "1/2", tg: "−√3/3", ctg: "−√3" },
  180: { cos: "−1", sin: "0", tg: "0", ctg: null },
  210: { cos: "−√3/2", sin: "−1/2", tg: "√3/3", ctg: "√3" },
  225: { cos: "−√2/2", sin: "−√2/2", tg: "1", ctg: "1" },
  240: { cos: "−1/2", sin: "−√3/2", tg: "√3", ctg: "√3/3" },
  270: { cos: "0", sin: "−1", tg: null, ctg: "0" },
  300: { cos: "1/2", sin: "−√3/2", tg: "−√3", ctg: "−√3/3" },
  315: { cos: "√2/2", sin: "−√2/2", tg: "−1", ctg: "−1" },
  330: { cos: "√3/2", sin: "−1/2", tg: "−√3/3", ctg: "−√3" },
};

const UNIT_TOGGLES = [
  ["showAxes", "Оси"],
  ["showAngles", "Углы"],
  ["showSin", "Синус"],
  ["showCos", "Косинус"],
  ["showTan", "Тангенс"],
  ["showCot", "Котангенс"],
  ["showValues", "Значения"],
];

function unitAngle(value) {
  const angle = Number(value);
  return UNIT_ANGLES.includes(angle) ? angle : 30;
}

function unitFlags(content = {}) {
  return {
    axes: content.showAxes !== false,
    angles: content.showAngles !== false,
    sin: Boolean(content.showSin),
    cos: Boolean(content.showCos),
    tan: Boolean(content.showTan),
    cot: Boolean(content.showCot),
    values: Boolean(content.showValues),
  };
}

function unitAnswer(angle, content = {}) {
  const flags = unitFlags(content);
  const row = UNIT_VALUE[unitAngle(angle)];
  const chosen = [];
  const push = (on, key, name) => {
    if (!on) return;
    const value = row[key];
    chosen.push(value == null ? `${name} не определён` : `${name} = ${value}`);
  };
  if (!flags.sin && !flags.cos && !flags.tan && !flags.cot) {
    return `cos = ${row.cos}, sin = ${row.sin}`;
  }
  push(flags.sin, "sin", "sin");
  push(flags.cos, "cos", "cos");
  push(flags.tan, "tg", "tg");
  push(flags.cot, "ctg", "ctg");
  return chosen.join(", ");
}

function unitPoint(angle, radius, center) {
  const rad = (Number(angle) * Math.PI) / 180;
  return [center + radius * Math.cos(rad), center - radius * Math.sin(rad)];
}

function unitRatio(angle, kind) {
  const rad = (unitAngle(angle) * Math.PI) / 180;
  if (kind === "tan") {
    if (Math.abs(Math.cos(rad)) < 1e-10) return null;
    return Math.tan(rad);
  }
  if (Math.abs(Math.sin(rad)) < 1e-10) return null;
  return Math.cos(rad) / Math.sin(rad);
}

function UnitCircleSvg({ content = {} }) {
  const flags = unitFlags(content);
  const marked = unitAngle(content.angle);
  const center = 200;
  const radius = 92;
  const [px, py] = unitPoint(marked, radius, center);
  const labelOf = (deg) => (content.unit === "deg" ? `${deg}°` : UNIT_RAD[deg]);
  const row = UNIT_VALUE[marked];
  const tan = flags.tan ? unitRatio(marked, "tan") : null;
  const cot = flags.cot ? unitRatio(marked, "cot") : null;
  const tanY = tan == null ? null : center - radius * tan;
  const cotX = cot == null ? null : center + radius * cot;
  const caption = flags.values ? unitAnswer(marked, content) : "";
  const arcLarge = marked > 180 ? 1 : 0;
  const arcEnd = unitPoint(marked, 28, center);
  return (
    <svg className="ws-unit" viewBox="0 0 400 430" role="img" aria-label="Тригонометрическая окружность">
      {flags.cot ? (
        <g>
          <line className="is-cot" x1="48" y1={center - radius} x2="364" y2={center - radius} />
          <text className="is-cot-label" x="8" y={center - radius} dominantBaseline="middle">ctg</text>
        </g>
      ) : null}
      {flags.tan ? (
        <g>
          <line className="is-tan" x1={center + radius} y1="36" x2={center + radius} y2="364" />
          <text className="is-tan-label" x={center + radius + 6} y="348">tg</text>
        </g>
      ) : null}
      {flags.axes ? (
        <g>
          <line className="is-axis" x1="28" y1={center} x2="372" y2={center} />
          <line className="is-axis" x1={center} y1="372" x2={center} y2="28" />
          <polygon className="is-arrow" points="372,200 362,195 362,205" />
          <polygon className="is-arrow" points="200,28 195,38 205,38" />
          <line x1={center + radius} y1={center - 4} x2={center + radius} y2={center + 4} />
          <line x1={center - radius} y1={center - 4} x2={center - radius} y2={center + 4} />
          <line x1={center - 4} y1={center - radius} x2={center + 4} y2={center - radius} />
          <line x1={center - 4} y1={center + radius} x2={center + 4} y2={center + radius} />
          <text x={center + radius - 8} y={center + 15} textAnchor="end">1</text>
          <text x={center - radius + 14} y={center + 16} textAnchor="start">−1</text>
          <text x={center + 12} y={center - radius + 16} textAnchor="start">1</text>
          <text x={center + 12} y={center + radius - 2} textAnchor="start">−1</text>
          <text className="is-axis-name" x="358" y={center + 16}>x</text>
          <text className="is-axis-name" x={center + 8} y="24">y</text>
        </g>
      ) : null}
      <circle cx={center} cy={center} r={radius} />
      {flags.axes || flags.angles ? (
        <text className="is-angle" x={center + radius + 6} y={center - 2} textAnchor="start" dominantBaseline="middle">{labelOf(0)}</text>
      ) : null}
      {flags.angles ? UNIT_ANGLES.filter((deg) => deg !== 0).map((deg) => {
        const [x, y] = unitPoint(deg, radius, center);
        const cardinal = deg % 90 === 0;
        const [lx, ly] = unitPoint(deg, radius + (cardinal ? 28 : 18), center);
        const cos = Math.cos((deg * Math.PI) / 180);
        return (
          <g key={deg}>
            <line className="is-muted" x1={center} y1={center} x2={x} y2={y} />
            <text className="is-angle" x={lx} y={deg === 180 ? ly - 12 : ly} textAnchor={Math.abs(cos) < 0.25 ? "middle" : cos > 0 ? "start" : "end"} dominantBaseline="middle">{labelOf(deg)}</text>
          </g>
        );
      }) : null}
      {flags.cos ? (
        <g>
          <line className="is-cos" x1={center} y1={center} x2={px} y2={center} />
          <text x={center + (px - center) * 0.42} y={center + (py < center ? 18 : -14)} textAnchor="middle">{flags.values ? row.cos : "cos"}</text>
        </g>
      ) : null}
      {flags.sin ? (
        <g>
          <line className="is-sin" x1={px} y1={py} x2={px} y2={center} />
          <line className="is-guide" x1={px} y1={py} x2={center} y2={py} />
          <text x={center - 12} y={py} textAnchor="end" dominantBaseline="middle">{flags.values ? row.sin : "sin"}</text>
        </g>
      ) : null}
      {flags.tan && tanY != null ? (
        <g>
          <line className="is-guide" x1={Math.cos((marked * Math.PI) / 180) > 0 ? px : center} y1={Math.cos((marked * Math.PI) / 180) > 0 ? py : center} x2={center + radius} y2={tanY} />
          <line className="is-tan-seg" x1={center + radius} y1={center} x2={center + radius} y2={tanY} />
          <circle className="is-tan-dot" cx={center + radius} cy={tanY} r="3.2" />
          {flags.values && row.tg ? <text className="is-tan-label" x={center + radius + 8} y={tanY} dominantBaseline="middle">{row.tg}</text> : null}
        </g>
      ) : null}
      {flags.cot && cotX != null ? (
        <g>
          <line className="is-guide" x1={Math.sin((marked * Math.PI) / 180) > 0 ? px : center} y1={Math.sin((marked * Math.PI) / 180) > 0 ? py : center} x2={cotX} y2={center - radius} />
          <line className="is-cot-seg" x1={center} y1={center - radius} x2={cotX} y2={center - radius} />
          <circle className="is-cot-dot" cx={cotX} cy={center - radius} r="3.2" />
          {flags.values && row.ctg ? <text className="is-cot-label" x={cotX} y={center - radius - 8} textAnchor="middle">{row.ctg}</text> : null}
        </g>
      ) : null}
      {marked ? <path className="is-arc" d={`M ${center + 28} ${center} A 28 28 0 ${arcLarge} 0 ${arcEnd[0]} ${arcEnd[1]}`} /> : null}
      <line className="is-ray" x1={center} y1={center} x2={px} y2={py} />
      <circle className="is-dot" cx={px} cy={py} r="3.4" />
      {caption ? <text className="is-value" x="200" y="412" textAnchor="middle">{caption}</text> : null}
    </svg>
  );
}

function UnitCircleEditor({ task, onChange }) {
  const angle = unitAngle(task.content?.angle);
  const setAngle = (next) => onChange(sync(task, { content: { angle: next }, answer: { value: unitAnswer(next, task.content) } }));
  const setFlag = (key, checked) => {
    const content = { [key]: checked };
    const affectsAnswer = key === "showSin" || key === "showCos" || key === "showTan" || key === "showCot";
    onChange(sync(task, affectsAnswer
      ? { content, answer: { value: unitAnswer(angle, { ...task.content, ...content }) } }
      : { content }));
  };
  return (
    <>
      <QuestionField task={task} onChange={onChange} />
      <Field label="Отмеченный угол">
        <select value={String(angle)} onChange={(event) => setAngle(Number(event.target.value))}>
          {UNIT_ANGLES.map((deg) => (
            <option key={deg} value={deg}>{task.content?.unit === "deg" ? `${deg}°` : UNIT_RAD[deg]}</option>
          ))}
        </select>
      </Field>
      <Field label="Подписи углов">
        <div className="ws-type-choice">
          {[["rad", "Радианы"], ["deg", "Градусы"]].map(([id, label]) => (
            <label key={id}>
              <input type="radio" checked={(task.content?.unit || "rad") === id} onChange={() => onChange(sync(task, { content: { unit: id } }))} /> {label}
            </label>
          ))}
        </div>
      </Field>
      <Field label="На окружности">
        <div className="ws-type-choice ws-opt-grid">
          {UNIT_TOGGLES.map(([key, label]) => {
            const checked = key === "showAxes" || key === "showAngles" ? task.content?.[key] !== false : Boolean(task.content?.[key]);
            return (
              <label key={key}>
                <input type="checkbox" checked={checked} onChange={(event) => setFlag(key, event.target.checked)} />
                {label}
              </label>
            );
          })}
        </div>
      </Field>
      <Field label="Правильный ответ">
        <input value={task.answer?.value || ""} onChange={(event) => onChange(sync(task, { answer: { value: event.target.value } }))} />
      </Field>
    </>
  );
}

const EDITORS = {
  short_answer: ShortAnswerEditor,
  solution: SolutionEditor,
  single_choice: ChoiceEditor,
  matching: MatchingEditor,
  fill_blank: FillBlankEditor,
  find_error: FindErrorEditor,
  table: TableEditor,
  function_graph: FunctionGraphEditor,
  coordinate_plane: CoordinateEditor,
  unit_circle: UnitCircleEditor,
  expression: ExpressionEditor,
  sorting: SortingEditor,
  classification: ClassificationEditor,
  text_questions: TextQuestionsEditor,
  image_question: ImageEditor,
  plane: PlaneEditor,
  solid: SolidEditor,
};

function stableShuffle(items, seed) {
  const copy = [...items];
  let state = [...String(seed)].reduce((sum, char) => (sum + char.charCodeAt(0)) % 233280, 17) || 17;
  for (let index = copy.length - 1; index > 0; index -= 1) {
    state = (state * 9301 + 49297) % 233280;
    const swap = state % (index + 1);
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function AnswerRule({ label }) {
  return (
    <p className="ws-answer-line">
      {label ? <span className="ws-answer-line__label">{label}</span> : null}
      <span className="ws-answer-line__rule" />
    </p>
  );
}

function SheetImage({ src, alt, width }) {
  const [ratio, setRatio] = useState(null);
  if (!src) return <p className="ws-placeholder">Добавьте изображение</p>;
  const size = Math.min(100, Math.max(40, Number(width) || 100));
  return (
    <img
      className="ws-type-image"
      src={src}
      alt={alt || ""}
      style={{ width: `${size}%`, maxWidth: "100%", height: "auto", objectFit: "contain", ...(ratio ? { aspectRatio: ratio } : {}) }}
      onLoad={(event) => {
        const { naturalWidth, naturalHeight } = event.currentTarget;
        if (naturalWidth && naturalHeight) setRatio(`${naturalWidth} / ${naturalHeight}`);
      }}
    />
  );
}

function solutionLines(content) {
  if (content?.lines === "large") return 6;
  const count = Number(content?.lines);
  return count > 0 ? count : 4;
}

function SortBoard({ items }) {
  const [order, setOrder] = useState(items);
  const [over, setOver] = useState(-1);
  const key = items.map((item) => item.id).join("|");
  useEffect(() => { setOrder(items); }, [key]);
  return (
    <ol className="ws-sort">
      {order.map((item, index) => (
        <li
          key={item.id}
          draggable
          className={over === index ? "is-over" : ""}
          onDragStart={(event) => {
            event.stopPropagation();
            event.dataTransfer.setData("text/plain", String(index));
            event.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(event) => { event.preventDefault(); setOver(index); }}
          onDrop={(event) => {
            event.preventDefault();
            const from = Number(event.dataTransfer.getData("text/plain"));
            setOver(-1);
            if (Number.isFinite(from) && from !== index) setOrder((current) => moveListItem(current, from, index));
          }}
          onDragEnd={() => setOver(-1)}
        >
          <span className="ws-drag" aria-hidden="true">☰</span>
          {item.text || "…"}
        </li>
      ))}
    </ol>
  );
}

function ClassifyBoard({ categories, items }) {
  const [placed, setPlaced] = useState({});
  const [over, setOver] = useState("");
  const key = `${categories.map((item) => item.id).join("|")}:${items.map((item) => item.id).join("|")}`;
  useEffect(() => { setPlaced({}); }, [key]);
  const dropOn = (categoryId) => (event) => {
    event.preventDefault();
    event.stopPropagation();
    const id = event.dataTransfer.getData("text/plain");
    if (!id) return;
    setPlaced((current) => ({ ...current, [id]: categoryId }));
    setOver("");
  };
  const chip = (item) => (
    <span
      key={item.id}
      className="ws-chip"
      draggable
      onDragStart={(event) => {
        event.stopPropagation();
        event.dataTransfer.setData("text/plain", item.id);
        event.dataTransfer.effectAllowed = "move";
      }}
    ><ElementFace text={item.text} image={item.image} /></span>
  );
  const pool = items.filter((item) => !placed[item.id]);
  return (
    <div className="ws-classify">
      <div className={`ws-classify__pool${over === "pool" ? " is-over" : ""}`} onDragOver={(event) => { event.preventDefault(); setOver("pool"); }} onDrop={dropOn("")}>
        {pool.length ? pool.map(chip) : <span className="ws-placeholder">Перетащите элементы в группы</span>}
      </div>
      {categories.map((category) => (
        <div key={category.id} className={over === category.id ? "is-over" : ""} onDragOver={(event) => { event.preventDefault(); setOver(category.id); }} onDrop={dropOn(category.id)}>
          <strong>{category.title}</strong>
          <div>{items.filter((item) => placed[item.id] === category.id).map(chip)}</div>
        </div>
      ))}
    </div>
  );
}

function OrderGrid({ count }) {
  return <div className="ws-gridpaper ws-order-box" style={{ minHeight: Math.max(3, count) * 32 }} aria-label="Запишите порядок" />;
}

function StudentView({ task, mode = "print", compose = false, onChange, focus, onFocus }) {
  const type = canonicalType(task.type);
  const interactive = mode === "interactive";
  const editText = (event) => event.stopPropagation();
  if (type === "short_answer") {
    return interactive
      ? <p className="ws-answer-line"><span className="ws-answer-line__label">Ответ</span><input className="ws-sheet-input" aria-label="Короткий ответ" /></p>
      : <AnswerRule label="Ответ" />;
  }
  if (type === "solution") {
    const lines = solutionLines(task.content);
    return (
      <>
        {task.content.showWork !== false ? (
          interactive
            ? <textarea className="ws-sheet-input" rows={lines} aria-label="Решение" style={{ minHeight: lines * 28 }} />
            : <div className="ws-ruled" style={{ minHeight: lines * 28 }} aria-hidden="true" />
        ) : null}
        {task.content.showAnswer !== false ? (
          interactive
            ? <p className="ws-answer-line"><span className="ws-answer-line__label">Ответ</span><input className="ws-sheet-input" aria-label="Конечный ответ" /></p>
            : <AnswerRule label="Ответ" />
        ) : null}
      </>
    );
  }
  if (type === "single_choice") {
    const multiple = !!task.content?.multiple;
    const group = (task.answer.options || []).map((option) => option.id).join("-") || "choice";
    return (
      <div className="ws-choice" role={interactive ? (multiple ? "group" : "radiogroup") : undefined} aria-label="Варианты ответа">
        {(task.answer.options || []).map((option, index) => (
          <label key={option.id} className="ws-choice__item">
            {interactive ? (
              <input type={multiple ? "checkbox" : "radio"} name={group} aria-label={option.text || option.label} />
            ) : (
              <span className={multiple ? "ws-box" : "ws-radio"} aria-hidden="true" />
            )}
            {compose && onChange ? (
              <input
                className="ws-inline-text"
                value={option.text}
                placeholder="Вариант"
                aria-label={`Вариант ${index + 1}`}
                onClick={editText}
                onChange={(event) => onChange(sync(task, { answer: { options: (task.answer.options || []).map((item) => item.id === option.id ? { ...item, text: event.target.value } : item) } }))}
              />
            ) : <span>{option.text || <em className="ws-placeholder">Вариант</em>}</span>}
          </label>
        ))}
      </div>
    );
  }
  if (type === "matching") {
    const pairs = task.answer.pairs || [];
    const right = compose ? pairs : stableShuffle(pairs, pairs.map((pair) => pair.rightId).join("|"));
    return (
      <>
        <div className="ws-match">
          <div>{pairs.map((pair, index) => <p key={pair.leftId}>{String.fromCharCode(65 + index)}. <ElementFace text={pair.left} image={pair.leftImage} /></p>)}</div>
          <div>{right.map((pair, index) => <p key={pair.rightId}>{index + 1}. <ElementFace text={pair.right} image={pair.rightImage} /></p>)}</div>
        </div>
        <table className="ws-match-key">
          <thead>
            <tr>
              {pairs.map((pair, index) => (
                <th key={pair.leftId} scope="col">{String.fromCharCode(65 + index)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {pairs.map((pair, index) => (
                <td key={`${pair.leftId}-a`}>
                  {interactive ? (
                    <select className="ws-sheet-input" aria-label={`Соответствие ${String.fromCharCode(65 + index)}`} defaultValue="">
                      <option value=""> </option>
                      {right.map((item, letter) => <option key={item.rightId} value={item.rightId}>{letter + 1}</option>)}
                    </select>
                  ) : <span className="ws-answer-line__rule" />}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </>
    );
  }
  if (type === "fill_blank") {
    if (compose && onChange) return <BlankSentence task={task} onChange={onChange} variant="sheet" />;
    return (
      <p className="ws-blanks">
        {(task.content.parts || []).map((part, index) => (
          part.type === "text" ? <span key={`t-${index}`}>{part.value}</span> : (
            interactive ? (
              (task.answer.blanks?.[part.id]?.kind === "choice") ? (
                <select key={part.id} className="ws-sheet-input ws-sheet-input--inline" aria-label="Пропуск" defaultValue="">
                  <option value=""> </option>
                  {(task.answer.blanks?.[part.id]?.choices || []).map((choice) => <option key={choice} value={choice}>{choice}</option>)}
                </select>
              ) : <input key={part.id} className="ws-sheet-input ws-sheet-input--inline" aria-label="Пропуск" />
            ) : <span key={part.id} className="ws-blank-chip"> ______ </span>
          )
        ))}
      </p>
    );
  }
  if (type === "find_error") {
    return (
      <>
        {(task.answer.steps || []).map((step, index) => (
          <p key={step.id}>{index + 1}. {step.text || <span className="ws-placeholder">Шаг решения</span>}{task.content.revealStep && step.wrong ? " — исправьте этот шаг" : ""}</p>
        ))}
        {interactive ? <p className="ws-answer-line"><span className="ws-answer-line__label">В чём ошибка?</span><input className="ws-sheet-input" aria-label="В чём ошибка" /></p> : <AnswerRule label="В чём ошибка?" />}
        {interactive ? <p className="ws-answer-line"><span className="ws-answer-line__label">Исправьте решение</span><input className="ws-sheet-input" aria-label="Исправленное решение" /></p> : <AnswerRule label="Исправьте решение" />}
      </>
    );
  }
  if (type === "table") {
    const cols = task.content.cols || 3;
    return (
      <table className="ws-type-table">
        <tbody>
          {Array.from({ length: task.content.rows || 3 }, (_, row) => (
            <tr key={row}>
              {Array.from({ length: cols }, (_, col) => {
                const index = row * cols + col;
                const cell = task.answer.cells?.[index] || { id: `c${index}`, kind: "given", value: "", correct: "" };
                const kind = cell.kind || "given";
                const header = kind === "header" || (row === 0 && task.content.headerRow === true) || (col === 0 && task.content.headerCol === true);
                const student = !header && kind === "student";
                const Tag = header && !compose ? "th" : "td";
                const write = (field, text) => {
                  const next = [...(task.answer.cells || [])];
                  next[index] = { ...cell, kind, [field]: text };
                  onChange(sync(task, { answer: { cells: next } }));
                };
                return (
                  <Tag key={col} className={`${header ? "is-head" : ""}${student ? " is-student" : ""}${compose && focus?.index === index ? " is-cell-on" : ""}`} scope={header && !compose ? (row === 0 ? "col" : "row") : undefined} onMouseDown={compose ? (event) => event.stopPropagation() : undefined}>
                    {compose && onChange ? (
                      <input
                        className="ws-inline-text"
                        value={student ? (cell.correct || "") : (cell.value || "")}
                        placeholder={student ? "Правильный ответ" : ""}
                        aria-label={`Ячейка ${row + 1}.${col + 1}`}
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => { editText(event); onFocus?.({ index }); }}
                        onChange={(event) => write(student ? "correct" : "value", event.target.value)}
                      />
                    ) : student
                      ? (interactive ? <input className="ws-sheet-input" aria-label={`Ячейка ${row + 1}.${col + 1}`} /> : <span className="ws-answer-line__rule" />)
                      : (cell.value || "")}
                  </Tag>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (type === "function_graph") {
    const series = [task.content.expression, ...(task.content.extras || [])];
    return (
      <>
        {task.content.showFormula !== false ? <p className="ws-math">{task.content.expression ? `f(x) = ${task.content.expression}` : <span className="ws-placeholder">Введите функцию</span>}</p> : null}
        {task.content.showPlane !== false ? (
          <GraphSvg
            expression={task.content.expression}
            series={series}
            viewport={task.content.viewport}
            points={task.answer.points}
            showGraph={task.content.showGraph !== false}
            showPoints={!!task.content.showPoints}
            showGrid={task.content.showGrid !== false}
          />
        ) : null}
      </>
    );
  }
  if (type === "coordinate_plane") {
    const figures = (task.answer.objects || []).filter((item) => compose || item.visibleToStudent !== false);
    return <GraphSvg expression="" viewport={task.content.viewport} figures={figures} showGraph={false} showPoints={false} showGrid />;
  }
  if (type === "unit_circle") {
    return (
      <>
        <UnitCircleSvg content={task.content} />
        {interactive ? <p className="ws-answer-line"><span className="ws-answer-line__label">Ответ</span><input className="ws-sheet-input" aria-label="Синус и косинус" /></p> : <AnswerRule label="Ответ" />}
      </>
    );
  }
  if (type === "expression") {
    return <p className="ws-math ws-math--display">{task.content.latex ? `\\(${task.content.latex}\\)` : <span className="ws-placeholder">Введите формулу</span>}</p>;
  }
  if (type === "sorting") {
    const source = task.answer.items || [];
    const items = compose ? source : stableShuffle(source, source.map((item) => item.id).join("|"));
    if (interactive) return <SortBoard items={items} />;
    if (compose) return <ol className="ws-order">{source.map((item) => <li key={item.id}>{item.text || "…"}</li>)}</ol>;
    return (
      <>
        <ul className="ws-order">{items.map((item) => <li key={item.id}>{item.text || "…"}</li>)}</ul>
        <p className="ws-caption">Запишите по порядку</p>
        <OrderGrid count={items.length} />
      </>
    );
  }
  if (type === "classification") {
    const source = task.answer.items || [];
    const categories = task.content.categories || [];
    const items = compose ? source : stableShuffle(source, source.map((item) => item.id).join("|"));
    if (interactive) return <ClassifyBoard categories={categories} items={items} />;
    if (compose) {
      return (
        <div className="ws-questions">
          {categories.map((category) => (
            <div key={category.id}>
              <strong>{category.title}</strong>
              <ul className="ws-order">
                {items.filter((item) => item.categoryId === category.id).map((item) => <li key={item.id}><ElementFace text={item.text} image={item.image} /></li>)}
              </ul>
            </div>
          ))}
        </div>
      );
    }
    return (
      <>
        <div className="ws-el-pool">
          {items.length ? items.map((item) => <ElementFace key={item.id} text={item.text} image={item.image} />) : <span className="ws-placeholder">Элементы для распределения</span>}
        </div>
        <div className="ws-classify-print">
          {categories.map((category) => (
            <div key={category.id}>
              <strong>{category.title}</strong>
              <div className="ws-gridpaper" style={{ minHeight: 64 }} aria-label={category.title} />
            </div>
          ))}
        </div>
      </>
    );
  }
  if (type === "text_questions") {
    return (
      <>
        <p className="ws-stimulus">{task.content.stimulus || <span className="ws-placeholder">Добавьте исходный текст</span>}</p>
        <div className="ws-questions">
        {(task.answer.questions || []).map((question, index) => (
          <div key={question.id}>
            <p>{index + 1}. {question.prompt || <span className="ws-placeholder">Вопрос</span>}</p>
            {interactive ? <input className="ws-sheet-input" aria-label={`Ответ на вопрос ${index + 1}`} /> : <AnswerRule label="Ответ" />}
          </div>
        ))}
        </div>
      </>
    );
  }
  if (type === "plane") {
    const figures = task.content.figures || [];
    const allow = PLANE_KINDS.map((item) => item.id);
    return (
      <>
        <SolidSheet
          figures={figures}
          arrange={compose && !!onChange}
          draw={(figure, onPick) => <PlaneSvg figure={figure} onPick={onPick} />}
          title={(figure) => planeKind(figure.kind).label}
          onMark={(figure, x, y) => {
            const model = planeModel(figure);
            const hit = nearestOnEdges(model.edges, x, y);
            if (!hit) return;
            const marks = [...(figure.marks || []), makeMark(figure, model, hit)];
            onChange(sync(task, { content: { figures: figures.map((item) => item.id === figure.id ? { ...item, marks } : item) } }));
          }}
          onReorder={(event, index) => {
            const next = applySolidDrop(figures, event, index, freshPlane, allow);
            if (next !== figures) onChange(sync(task, { content: { figures: next } }));
          }}
        />
        {interactive ? <p className="ws-answer-line"><span className="ws-answer-line__label">Ответ</span><input className="ws-sheet-input" aria-label="Ответ" /></p> : <AnswerRule label="Ответ" />}
      </>
    );
  }
  if (type === "solid") {
    const figures = task.content.figures || [];
    return (
      <>
        <SolidSheet
          figures={figures}
          arrange={compose && !!onChange}
          onMark={(figure, x, y) => {
            const model = solidModel(figure);
            const hit = nearestOnEdges(model.edges, x, y);
            if (!hit) return;
            const marks = [...(figure.marks || []), makeMark(figure, model, hit)];
            onChange(sync(task, { content: { figures: figures.map((item) => item.id === figure.id ? { ...item, marks } : item) } }));
          }}
          onReorder={(event, index) => {
            const next = applySolidDrop(figures, event, index, freshSolid, SOLID_KINDS.map((item) => item.id));
            if (next !== figures) onChange(sync(task, { content: { figures: next } }));
          }}
        />
        {interactive ? <p className="ws-answer-line"><span className="ws-answer-line__label">Ответ</span><input className="ws-sheet-input" aria-label="Ответ" /></p> : <AnswerRule label="Ответ" />}
      </>
    );
  }
  if (type === "image_question") {
    return (
      <>
        <SheetImage src={task.content.imageUrl} alt={task.content.caption || ""} width={task.content.width} />
        {task.content.caption ? <p className="ws-caption">{task.content.caption}</p> : null}
        {interactive ? <input className="ws-sheet-input" aria-label="Ответ по изображению" /> : <AnswerRule label="Ответ" />}
      </>
    );
  }
  return null;
}

function TeacherView({ task, mode = "print", compose = false, onChange, focus, onFocus }) {
  const type = canonicalType(task.type);
  return (
    <div className="ws-teacher">
      <StudentView task={task} mode={mode} compose={compose} onChange={onChange} focus={focus} onFocus={onFocus} />
      {type === "short_answer" ? <p className="ws-key">Ответ: {(task.answer.values || []).filter(Boolean).join(" / ")}</p> : null}
      {type === "solution" ? <p className="ws-key">Ответ: {task.answer.final}<br />{task.answer.solution}</p> : null}
      {type === "single_choice" ? <p className="ws-key">Верные: {(task.answer.options || []).filter((item) => item.correct).map((item) => item.label).join(", ")}</p> : null}
      {type === "matching" ? <p className="ws-key">{(task.answer.pairs || []).map((pair) => `${String(pair.left || "").trim() || (pair.leftImage ? "рисунок" : "…")} → ${String(pair.right || "").trim() || (pair.rightImage ? "рисунок" : "…")}`).join("; ")}</p> : null}
      {type === "find_error" ? <p className="ws-key">{task.answer.explanation}<br />{task.answer.correction}</p> : null}
      {type === "expression" || type === "image_question" || type === "solid" || type === "plane" || type === "unit_circle" ? <p className="ws-key">Ответ: {task.answer.value}</p> : null}
      {type === "sorting" ? <p className="ws-key">Порядок: {(task.answer.items || []).map((item) => item.text).join(" → ")}</p> : null}
    </div>
  );
}

export function TaskSheetFace({ task, view, mode = "editor", compose = false, onChange, focus, onFocus }) {
  const normalized = normalizeTask(task);
  const face = mode === "interactive" ? "interactive" : "print";
  const editing = compose && mode === "editor";
  const shared = { compose: editing, onChange: editing ? onChange : undefined, focus, onFocus };
  if (view === "teacher" && mode !== "print" && mode !== "interactive") {
    return <TeacherView task={normalized} mode="print" {...shared} />;
  }
  return <StudentView task={normalized} mode={face} {...shared} />;
}

export function TaskInspector({ task, onChange, focus, onFocus }) {
  const normalized = normalizeTask(task);
  const Editor = EDITORS[canonicalType(normalized.type)];
  return (
    <div className="ws-inspector-fields">
      {Editor ? <Editor task={normalized} onChange={onChange} focus={focus} onFocus={onFocus} /> : null}
    </div>
  );
}
