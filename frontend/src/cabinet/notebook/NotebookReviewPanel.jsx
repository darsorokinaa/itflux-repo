import { useState } from "react";
import { Check, Lock, MessageSquare, X } from "lucide-react";

const QUICK_FEEDBACK = [
  ["Хорошая работа", "Хорошая работа!"],
  ["Вычисления", "Проверь вычисления."],
  ["Пояснение", "Добавь пояснение к решению."],
];

function formatCommentTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function NotebookReviewPanel({
  open,
  onClose,
  readOnly,
  pageLabel,
  pageComments,
  allComments,
  feedback,
  onFeedback,
  onAddComment,
  onResolve,
  onDelete,
  onOpenPage,
  onStamp,
}) {
  const [filter, setFilter] = useState("page");
  const [draft, setDraft] = useState(feedback || "");
  const [draftPage, setDraftPage] = useState(pageLabel);
  const [composer, setComposer] = useState("");
  const [focusedId, setFocusedId] = useState("");
  const comments = filter === "all" ? allComments : pageComments;

  if (draftPage !== pageLabel) {
    setDraftPage(pageLabel);
    setDraft(feedback || "");
  }

  if (!open) return null;

  const commitFeedback = (value) => {
    setDraft(value);
    onFeedback?.(value);
  };

  return (
    <aside className="hw-nb-review" aria-label="Комментарии к работе">
      <header className="hw-nb-review-heading">
        <h2>Комментарии</h2>
        <span className="hw-nb-count">{comments.length}</span>
        <button type="button" className="hw-nb-icon-btn" onClick={onClose} aria-label="Закрыть комментарии">
          <X size={16} />
        </button>
      </header>
      <div className="hw-nb-review-tabs" role="tablist" aria-label="Фильтр комментариев">
        <button type="button" role="tab" aria-selected={filter === "page"} className={filter === "page" ? "is-active" : ""} onClick={() => setFilter("page")}>
          На странице
        </button>
        <button type="button" role="tab" aria-selected={filter === "all"} className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")}>
          Все
        </button>
      </div>
      <div className="hw-nb-review-list" role="tabpanel">
        {comments.length ? comments.map((comment, index) => (
          <article
            key={comment.id}
            className={`hw-nb-comment${comment.resolved ? " is-resolved" : ""}${focusedId === comment.id ? " is-focused" : ""}`}
          >
            <div className="hw-nb-comment-top">
              <span className="hw-nb-comment-num">{index + 1}</span>
              <strong>{comment.pageLabel || pageLabel}</strong>
              {!readOnly ? (
                <button type="button" className="hw-nb-icon-btn" aria-label="Удалить комментарий" onClick={() => onDelete?.(comment)}>
                  <X size={13} />
                </button>
              ) : null}
            </div>
            <p className="hw-nb-comment-text">{comment.text}</p>
            <div className="hw-nb-comment-foot">
              <button
                type="button"
                className="hw-nb-resolve"
                disabled={readOnly}
                onClick={() => {
                  setFocusedId(comment.id);
                  onOpenPage?.(comment.pageIndex);
                  onResolve?.(comment);
                }}
              >
                <Check size={12} />
                {comment.resolved ? "Решено" : "Отметить решённым"}
              </button>
              <time className="hw-nb-comment-time">{formatCommentTime(comment.createdAt)}</time>
            </div>
          </article>
        )) : (
          <div className="hw-nb-review-empty">
            <span className="hw-nb-review-empty-icon" aria-hidden="true"><MessageSquare size={18} /></span>
            <strong>Пока нет комментариев</strong>
            <p>Замечание можно привязать к странице. Пометки на листе остаются отдельно.</p>
          </div>
        )}
        {!readOnly ? (
          <form
            className="hw-nb-comment-form"
            onSubmit={(event) => {
              event.preventDefault();
              const text = composer.trim();
              if (!text) return;
              onAddComment?.(text);
              setComposer("");
            }}
          >
            <label className="sr-only" htmlFor="hw-nb-new-comment">Новый комментарий</label>
            <textarea
              id="hw-nb-new-comment"
              value={composer}
              maxLength={2000}
              rows={2}
              placeholder="Новое замечание к этой странице"
              onChange={(event) => setComposer(event.target.value)}
            />
            <button type="submit" className="hw-nb-side-btn hw-nb-side-btn--soft" disabled={!composer.trim()}>
              Добавить комментарий
            </button>
          </form>
        ) : null}
      </div>
      <div className="hw-nb-review-bottom">
        <label className="hw-nb-field-label" htmlFor="hw-nb-feedback">
          <MessageSquare size={13} />
          Комментарий к странице
        </label>
        <textarea
          id="hw-nb-feedback"
          className="hw-nb-feedback"
          value={draft}
          readOnly={readOnly}
          maxLength={4000}
          placeholder="Что получилось и на что обратить внимание…"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (!readOnly && draft !== (feedback || "")) onFeedback?.(draft);
          }}
        />
        {!readOnly ? (
          <div className="hw-nb-quick">
            {QUICK_FEEDBACK.map(([label, phrase]) => (
              <button key={label} type="button" onClick={() => commitFeedback(draft.trim() ? `${draft.trim()} ${phrase}` : phrase)}>
                {label}
              </button>
            ))}
          </div>
        ) : null}
        {!readOnly ? (
          <div className="hw-nb-stamps">
            <div className="hw-nb-stamp-heading">Быстрые пометки на листе</div>
            <div className="hw-nb-stamp-row">
              <button type="button" className="hw-nb-stamp" onClick={() => onStamp?.("check")}>
                <Check size={14} />
                Верно
              </button>
              <button type="button" className="hw-nb-stamp is-wrong" onClick={() => onStamp?.("cross")}>
                <X size={14} />
                Ошибка
              </button>
            </div>
          </div>
        ) : null}
        <p className="hw-nb-review-note">
          <Lock size={11} />
          <span>Пометки сохраняются автоматически. Ученик увидит проверку после «Готово».</span>
        </p>
      </div>
    </aside>
  );
}
