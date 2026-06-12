import { type ReactNode } from "react";

export type StateVariant =
  | "loading"
  | "empty"
  | "search"
  | "error"
  | "locked"
  | "draft";

type StateViewProps = {
  variant?: StateVariant;
  title: string;
  description?: ReactNode;
  /** Кнопка/ссылка действия снизу (например «Сбросить фильтры»). */
  action?: ReactNode;
  /** Переопределить иконку варианта. */
  icon?: ReactNode;
  /** Более компактный вид (внутри узких блоков). */
  compact?: boolean;
  className?: string;
};

function VariantIcon({ variant }: { variant: StateVariant }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (variant) {
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.2-3.2" />
        </svg>
      );
    case "error":
      return (
        <svg {...common}>
          <path d="M12 3 2.5 20h19Z" />
          <path d="M12 10v4" />
          <path d="M12 17.5h.01" />
        </svg>
      );
    case "locked":
      return (
        <svg {...common}>
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
      );
    case "draft":
      return (
        <svg {...common}>
          <path d="M5 3h9l5 5v13a0 0 0 0 1 0 0H5a0 0 0 0 1 0 0Z" />
          <path d="M14 3v5h5" />
          <path d="M9 13h6" />
          <path d="M9 17h4" />
        </svg>
      );
    case "empty":
    default:
      return (
        <svg {...common}>
          <path d="M4 7.5 12 4l8 3.5v9L12 20l-8-3.5Z" />
          <path d="M4 7.5 12 11l8-3.5" />
          <path d="M12 11v9" />
        </svg>
      );
  }
}

/**
 * Спокойное единое состояние: загрузка / пусто / нет результатов / ошибка /
 * доступ закрыт / черновик. Заголовок + пояснение + (опц.) действие.
 */
export default function StateView({
  variant = "empty",
  title,
  description,
  action,
  icon,
  compact = false,
  className,
}: StateViewProps) {
  const isLoading = variant === "loading";
  const role = variant === "error" ? "alert" : "status";

  return (
    <div
      className={[
        "state-view",
        `state-view--${variant}`,
        compact ? "state-view--compact" : "",
        className || "",
      ]
        .filter(Boolean)
        .join(" ")}
      role={role}
      aria-live={isLoading ? "polite" : undefined}
      aria-busy={isLoading ? true : undefined}
    >
      <div className="state-view__visual" aria-hidden="true">
        {isLoading ? (
          <span className="state-view__spinner" />
        ) : (
          icon ?? <VariantIcon variant={variant} />
        )}
      </div>
      <p className="state-view__title">{title}</p>
      {description ? <p className="state-view__desc">{description}</p> : null}
      {action ? <div className="state-view__action">{action}</div> : null}
    </div>
  );
}
