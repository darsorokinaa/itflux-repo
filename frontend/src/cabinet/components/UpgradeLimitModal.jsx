/**
 * UpgradeLimitModal — модальное окно при достижении лимита.
 *
 * Props:
 *   type: "students" | "groups" | "lessons" | "interactives" | "ai" | "feature"
 *   current, limit — числа
 *   currentPlan — { name, slug }
 *   recommendedPlan — slug
 *   onUpgrade — callback при нажатии "Увеличить лимит"
 *   onClose
 */

import { useEffect } from "react";

const COPY = {
  students: {
    title: "Лимит учеников исчерпан",
    text: (plan, limit) => `На тарифе «${plan}» доступно ${limit} учеников.`,
    action: "Увеличить лимит",
  },
  groups: {
    title: "Лимит групп исчерпан",
    text: (plan, limit) => `На тарифе «${plan}» доступно ${limit} групп.`,
    action: "Увеличить лимит",
  },
  lessons: {
    title: "Лимит уроков исчерпан",
    text: (plan, limit) => `На тарифе «${plan}» доступно ${limit} уроков.`,
    action: "Увеличить лимит",
  },
  interactives: {
    title: "Лимит интерактивов исчерпан",
    text: (plan, limit) => `На тарифе «${plan}» доступно ${limit} интерактивов.`,
    action: "Увеличить лимит",
  },
  ai: {
    title: "ИИ-запросы закончились",
    text: (plan, limit) => `На тарифе «${plan}» доступно ${limit} запросов в месяц.`,
    action: "Увеличить лимит",
  },
  feature: {
    title: "Функция недоступна",
    text: (plan) => `Недоступно на тарифе «${plan}».`,
    action: "Открыть доступ",
  },
};

export default function UpgradeLimitModal({
  type = "students",
  current,
  limit,
  currentPlan,
  recommendedPlan,
  onUpgrade,
  onClose,
}) {
  const copy = COPY[type] || COPY.students;
  const planName = currentPlan?.name || "Старт";

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="upm-backdrop" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="upm-sheet">
        <button type="button" className="upm-close" onClick={onClose} aria-label="Закрыть">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>

        <div className="upm-icon" aria-hidden="true">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="16" fill="#EEF2FF" />
            <path d="M16 10v7M16 21v1" stroke="#2563EB" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </div>

        <h2 className="upm-title">{copy.title}</h2>
        <p className="upm-text">{copy.text(planName, limit)}</p>
        {type !== "feature" && (
          <p className="upm-hint">Чтобы добавить ещё, увеличьте лимит.</p>
        )}

        <div className="upm-actions">
          <button type="button" className="upm-btn upm-btn--primary" onClick={onUpgrade}>
            {copy.action}
          </button>
          <button type="button" className="upm-btn upm-btn--ghost" onClick={onClose}>
            Позже
          </button>
        </div>
      </div>
    </div>
  );
}
