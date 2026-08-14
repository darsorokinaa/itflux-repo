import { openConnectionCheck } from "./openConnectionCheck";

export default function ConnectionCheckButton({
  className = "cb-btn cb-btn--outline",
  label = "Проверить связь",
  canJoin = false,
  joinHref = "",
  joinLabel = "Перейти в урок",
  onJoin,
  onClick,
  ...rest
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
        openConnectionCheck({ canJoin, joinHref, joinLabel, onJoin });
      }}
      {...rest}
    >
      {label}
    </button>
  );
}
