import { useState } from "react";
import {
  ACCESS_OPTIONS,
  DIFFICULTY_OPTIONS,
  EXAM_OPTIONS,
  getTypeMeta,
} from "../interactivesData";

function EditorAccordion({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="ix-editor-accordion">
      <button type="button" className="ix-editor-accordion__head" onClick={() => setOpen((v) => !v)}>
        <span>{title}</span>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>
      {open ? <div className="ix-editor-accordion__body">{children}</div> : null}
    </div>
  );
}

export default function InteractiveCommonSettings({ data, onChange }) {
  return (
    <div className="cb-interactive-editor__common">
      <h2 className="cb-interactive-editor__section-title">Настройки</h2>
      <div className="ix-editor-compact-grid">
        <label className="cb-field">
          <span>Тип</span>
          <input value={getTypeMeta(data.type).label} readOnly disabled />
        </label>
        <label className="cb-field">
          <span>Предмет</span>
          <input value={data.subject} onChange={(e) => onChange("subject", e.target.value)} />
        </label>
        <label className="cb-field">
          <span>Экзамен</span>
          <select value={data.exam} onChange={(e) => onChange("exam", e.target.value)}>
            {EXAM_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </label>
        <label className="cb-field">
          <span>Тема</span>
          <input value={data.topic} onChange={(e) => onChange("topic", e.target.value)} />
        </label>
        <label className="cb-field">
          <span>Сложность</span>
          <select value={data.difficulty} onChange={(e) => onChange("difficulty", e.target.value)}>
            {DIFFICULTY_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </label>
        <label className="cb-field">
          <span>Статус</span>
          <select value={data.status} onChange={(e) => onChange("status", e.target.value)}>
            <option value="draft">Черновик</option>
            <option value="published">Опубликован</option>
          </select>
        </label>
        <label className="cb-field">
          <span>Доступ</span>
          <select value={data.access} onChange={(e) => onChange("access", e.target.value)}>
            {ACCESS_OPTIONS.map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
          </select>
        </label>
      </div>
      <EditorAccordion title="Дополнительно">
        <div className="ix-editor-compact-grid">
          <label className="cb-field">
            <span>Подтема</span>
            <input value={data.subtopic} onChange={(e) => onChange("subtopic", e.target.value)} />
          </label>
          <label className="cb-field">
            <span>№ задания</span>
            <input value={data.taskNumber} onChange={(e) => onChange("taskNumber", e.target.value)} />
          </label>
          <label className="cb-field cb-field--wide">
            <span>Инструкция для ученика</span>
            <textarea rows={2} value={data.instruction} onChange={(e) => onChange("instruction", e.target.value)} placeholder="Короткая подсказка перед началом" />
          </label>
        </div>
      </EditorAccordion>
    </div>
  );
}
