/**
 * Блок «Требует внимания» — только при наличии проблемных элементов.
 * variant: "block" (полная секция) | "hero" (компактно в шапке)
 */
export default function JournalAttentionBlock({ items = [], onAction, variant = "block" }) {
  if (!items.length) return null;

  if (variant === "hero") {
    return (
      <div className="jg-attention jg-attention--hero" aria-label="Требует внимания">
        <span className="jg-attention__title jg-attention__title--inline">Требует внимания</span>
        <ul className="jg-attention__list jg-attention__list--hero">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={`jg-attention__item jg-attention__item--compact jg-attention__item--chip jg-attention__item--${item.tone || "warn"}`}
                onClick={() => onAction?.(item)}
                title={item.detail || item.title}
              >
                <span className="jg-attention__icon" aria-hidden="true">
                  {item.icon || "!"}
                </span>
                <span className="jg-attention__body">
                  <strong>{item.title}</strong>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <section className="jg-attention" aria-label="Требует внимания">
      <div className="jg-attention__head">
        <h2 className="jg-attention__title">Требует внимания</h2>
        <p className="jg-attention__lead">Сигналы, на которые стоит взглянуть сейчас</p>
      </div>
      <ul className="jg-attention__list">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={`jg-attention__item jg-attention__item--${item.tone || "warn"}`}
              onClick={() => onAction?.(item)}
            >
              <span className="jg-attention__icon" aria-hidden="true">
                {item.icon || "!"}
              </span>
              <span className="jg-attention__body">
                <strong>{item.title}</strong>
                {item.detail ? <span>{item.detail}</span> : null}
              </span>
              <span className="jg-attention__cta">{item.cta || "Открыть"}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function buildJournalAttentionItems({
  summary,
  lessons = [],
  entriesSummary,
  errorsCount = 0,
  scopeMode,
}) {
  const items = [];
  const hw = summary?.homework || {};
  const lessonWork = summary?.lesson_work || {};
  const attendance = summary?.attendance || {};
  const pendingReview = Number(entriesSummary?.homework_pending_review || 0);
  const overdue = Number(entriesSummary?.homework_overdue || 0);
  const attentionCount = Number(lessonWork.attention_count || 0);
  const absent = Number(attendance.absent || 0);

  const lessonsWithoutActual = (lessons || []).filter((lesson) => {
    const status = String(lesson.status || "").toLowerCase();
    const conducted = status === "completed" || Boolean(lesson.actual_topic);
    if (!conducted && status === "draft") return false;
    return !String(lesson.actual_topic || "").trim() && status === "completed";
  }).length;

  if (errorsCount > 0 && scopeMode === "student") {
    items.push({
      id: "errors",
      tone: "warn",
      icon: "⚠",
      title: `${errorsCount} ${pluralErrors(errorsCount)}`,
      detail: "Можно собрать работу над ошибками",
      cta: "К ошибкам",
      action: "errors",
    });
  }

  if (pendingReview > 0) {
    items.push({
      id: "pending-review",
      tone: "info",
      icon: "📄",
      title: `${pendingReview} ${pluralWorks(pendingReview)} ожидают проверки`,
      detail: "Откройте ленту активности с фильтром «На проверке»",
      cta: "К проверке",
      action: "pending_review",
    });
  }

  if (overdue > 0) {
    items.push({
      id: "overdue",
      tone: "danger",
      icon: "⏰",
      title: `${overdue} просроченных заданий`,
      detail: "Покажите просроченные в ленте активности",
      cta: "Показать",
      action: "overdue",
    });
  }

  if (lessonsWithoutActual > 0) {
    items.push({
      id: "missing-topic",
      tone: "warn",
      icon: "📅",
      title:
        lessonsWithoutActual === 1
          ? "В одном уроке не указана фактическая тема"
          : `В ${lessonsWithoutActual} уроках не указана фактическая тема`,
      detail: "Добавьте тему в карточке урока",
      cta: "К урокам",
      action: "lessons",
    });
  }

  if (attentionCount > 0) {
    items.push({
      id: "low-results",
      tone: "warn",
      icon: "↓",
      title: `${attentionCount} ${pluralLessons(attentionCount)} с низким результатом`,
      detail: "Отмечены как требующие внимания",
      cta: "К урокам",
      action: "lessons",
    });
  }

  if (absent > 0) {
    items.push({
      id: "absent",
      tone: "muted",
      icon: "∅",
      title: `${absent} ${pluralMissed(absent)}`,
      detail: "Проверьте посещаемость в подробной статистике",
      cta: "Статистика",
      action: "analytics",
    });
  }

  return items.slice(0, 5);
}

function pluralErrors(n) {
  if (n % 10 === 1 && n % 100 !== 11) return "ошибка";
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return "ошибки";
  return "ошибок";
}

function pluralWorks(n) {
  if (n % 10 === 1 && n % 100 !== 11) return "работа";
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return "работы";
  return "работ";
}

function pluralLessons(n) {
  if (n % 10 === 1 && n % 100 !== 11) return "урок";
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return "урока";
  return "уроков";
}

function pluralMissed(n) {
  if (n % 10 === 1 && n % 100 !== 11) return "пропуск";
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return "пропуска";
  return "пропусков";
}
