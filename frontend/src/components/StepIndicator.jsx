export default function StepIndicator({ items = [], activeIndex = 0, className = "" }) {
  return (
    <ol className={`tool-stepper ${className}`.trim()} aria-label="Прогресс по шагам">
      {items.map((item, index) => {
        const isActive = index === activeIndex;
        const isDone = index < activeIndex;
        const stateClass = isActive ? "is-active" : isDone ? "is-done" : "is-idle";
        return (
          <li key={item.title || index} className={`tool-stepper__item ${stateClass}`}>
            <span className="tool-stepper__index" aria-hidden>
              {index + 1}
            </span>
            <span className="tool-stepper__text">
              <span className="tool-stepper__title">{item.title}</span>
              {item.caption ? <span className="tool-stepper__caption">{item.caption}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
