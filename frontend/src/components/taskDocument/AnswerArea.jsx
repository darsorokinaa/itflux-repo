export default function AnswerArea({
  mode = "print",
  value = "",
  onChange,
  disabled = false,
  inputId,
  className = "",
  children,
}) {
  return (
    <div className={`tdoc-answer ${className}`.trim()}>
      {mode === "interactive" ? (
        <>
          <label className="tdoc-answer__label exam-task-answer__label" htmlFor={inputId}>
            Ответ
          </label>
          <div className="tdoc-answer__row exam-task-answer__row">
            <input
              id={inputId}
              type="text"
              className="tdoc-answer__input exam-task-input"
              value={value}
              disabled={disabled}
              onChange={onChange}
              autoComplete="off"
              placeholder="Введите ответ"
            />
            {children}
          </div>
          <p className="tdoc-answer__print" aria-hidden="true">
            Ответ: __________________________
          </p>
        </>
      ) : (
        <p className="tdoc-answer__print tdoc-answer__print--always">
          <span className="tdoc-answer__label">Ответ:</span>
          <span className="tdoc-answer__line" />
        </p>
      )}
    </div>
  );
}
