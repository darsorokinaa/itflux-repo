export default function LessonBoardMessage({ title, text, onRetry }) {
  return (
    <div
      className={`lesson-board__status${title ? " lesson-board__status--error" : " lesson-board__status--loading"}`}
      role={onRetry ? "alert" : "status"}
      data-testid="board-v2-status"
    >
      <div className="lesson-board__card">
        {title ? <h2>{title}</h2> : null}
        {text ? <p>{text}</p> : null}
        {onRetry ? (
          <button type="button" className="cb-board-editor__btn cb-board-editor__btn--primary" onClick={onRetry}>
            Повторить
          </button>
        ) : null}
      </div>
    </div>
  );
}
