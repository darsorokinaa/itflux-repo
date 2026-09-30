import { useState } from "react";
import { pickScienceFact, type ScienceFact } from "../content/scienceFacts";

export const LOADING_MESSAGES = {
  page: "Подготавливаем страницу…",
  data: "Загружаем данные…",
  material: "Подготавливаем материал…",
  worksheet: "Создаём рабочий лист…",
  save: "Сохраняем изменения…",
  file: "Загружаем файл…",
  lesson: "Подготавливаем урок…",
  fetch: "Получаем данные…",
  almost: "Почти готово…",
} as const;

export type LoadingMessage = (typeof LOADING_MESSAGES)[keyof typeof LOADING_MESSAGES];

type EducationalLoadingProps = {
  message?: string;
  fact?: ScienceFact;
  compact?: boolean;
  align?: "center" | "start";
  className?: string;
};

export function ScienceFactNote({
  fact,
  className = "",
}: {
  fact?: ScienceFact;
  className?: string;
}) {
  const [chosen] = useState(() => fact || pickScienceFact());
  const item = fact || chosen;

  return (
    <aside className={["edu-fact", className].filter(Boolean).join(" ")}>
      <p className="edu-fact__label">Интересный факт</p>
      <p className="edu-fact__text">{item.text}</p>
    </aside>
  );
}

export default function EducationalLoading({
  message = LOADING_MESSAGES.page,
  fact,
  compact = false,
  align = "center",
  className = "",
}: EducationalLoadingProps) {
  return (
    <div
      className={[
        "edu-wait",
        compact ? "edu-wait--compact" : "",
        align === "start" ? "edu-wait--start" : "",
        className,
      ].filter(Boolean).join(" ")}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="edu-wait__indicator" aria-hidden="true">
        <span className="edu-wait__spinner" />
      </span>
      <p className="edu-wait__message">{message}</p>
      <ScienceFactNote fact={fact} />
    </div>
  );
}
