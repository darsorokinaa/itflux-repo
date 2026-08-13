import { useId, useState } from "react";
import CabinetFloatingMenu from "./components/CabinetFloatingMenu";
import "../styles/cabinet-homework-card.css";

const DEADLINE_TONES = ["default", "today", "overdue", "review", "completed", "draft", "info"];

const PROGRESS_TONES = ["default", "overdue", "completed", "review"];

export const HW_COVER_VARIANTS = [
  "ocean",
  "sunset",
  "forest",
  "lavender",
  "violet",
  "coral",
  "mint",
  "amber",
  "sky",
  "rose",
  "indigo",
];

/** Стабильный цвет обложки по id / заголовку карточки */
export function pickCoverVariant(seed, pool = HW_COVER_VARIANTS) {
  const variants = pool?.length ? pool : HW_COVER_VARIANTS;
  const str = String(seed ?? "default");
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return variants[Math.abs(hash) % variants.length];
}

function HomeworkCover({ deadlineLabel, deadlineTone, coverImageUrl, coverBgColor, coverVariant }) {
  const safeTone = DEADLINE_TONES.includes(deadlineTone) ? deadlineTone : "default";
  const safeVariant = HW_COVER_VARIANTS.includes(coverVariant) ? coverVariant : "ocean";
  const coverStyle = {};
  if (!coverImageUrl && coverBgColor) {
    coverStyle.background = coverBgColor;
  }

  return (
    <div
      className={`cb-hw-cover cb-hw-cover--variant-${safeVariant}${coverImageUrl ? " cb-hw-cover--image" : ""}`}
      style={Object.keys(coverStyle).length ? coverStyle : undefined}
    >
      {deadlineLabel ? (
        <span className={`cb-hw-cover__badge cb-hw-cover__badge--${safeTone}`}>
          {deadlineLabel}
        </span>
      ) : null}
      {coverImageUrl ? (
        <img src={coverImageUrl} alt="" className="cb-hw-cover__image" loading="lazy" decoding="async" />
      ) : (
        <HomeworkCoverWaves />
      )}
    </div>
  );
}

function HomeworkCoverWaves() {
  return (
    <div className="cb-hw-cover__waves" aria-hidden="true">
      <svg className="cb-hw-cover__wave cb-hw-cover__wave--1" viewBox="0 0 400 104" preserveAspectRatio="none">
        <path d="M0,68 C48,36 112,92 192,48 C272,8 336,72 400,44 L400,104 L0,104 Z" />
      </svg>
      <svg className="cb-hw-cover__wave cb-hw-cover__wave--2" viewBox="0 0 400 104" preserveAspectRatio="none">
        <path d="M0,84 C64,52 136,96 216,64 C296,32 352,88 400,72 L400,104 L0,104 Z" />
      </svg>
      <svg className="cb-hw-cover__wave cb-hw-cover__wave--3" viewBox="0 0 400 104" preserveAspectRatio="none">
        <path d="M0,96 C80,76 160,100 240,82 C320,64 360,98 400,88 L400,104 L0,104 Z" />
      </svg>
    </div>
  );
}

/**
 * Карточка домашнего задания для личного кабинета учителя.
 *
 * @param {object} props
 * @param {string} [props.coverVariant] — палитра волн (ocean, sunset, …)
 * @param {'exam'|'python'|'logic'|'general'} [props.coverType]
 * @param {string} props.deadlineLabel — бейдж на обложке
 * @param {'default'|'today'|'overdue'|'review'|'completed'|'draft'} [props.deadlineTone]
 * @param {string} props.subject — «ОГЭ · Информатика»
 * @param {string} props.title
 * @param {string} props.description
 * @param {string} props.progressLabel — «5 из 8 выполнили»
 * @param {number} [props.progressPercent] — 0–100
 * @param {'default'|'overdue'|'completed'|'review'} [props.progressTone]
 * @param {{ initials: string }[]} [props.students]
 * @param {number} [props.overflowCount]
 * @param {string} props.actionLabel
 * @param {boolean} [props.actionPrimary]
 * @param {string} [props.coverImageUrl] — обложка из БД (вместо волн)
 * @param {string} [props.coverBgColor] — HEX-фон, если нет картинки
 * @param {boolean} [props.hideProgressBar]
 * @param {() => void} [props.onAction]
 * @param {string} [props.secondaryActionLabel]
 * @param {() => void} [props.onSecondaryAction]
 * @param {string} [props.dangerActionLabel] — действие в меню «…»
 * @param {() => void} [props.onDangerAction]
 * @param {boolean} [props.dangerActionDisabled]
 * @param {string} [props.dangerActionDisabledHint]
 */
export default function CabinetHomeworkCard({
  coverVariant,
  coverType = "general",
  coverImageUrl,
  coverBgColor,
  deadlineLabel,
  deadlineTone = "default",
  subject,
  title,
  description,
  progressLabel,
  progressPercent = 0,
  progressTone = "default",
  hideProgressBar = false,
  students = [],
  overflowCount = 0,
  actionLabel = "Открыть",
  actionPrimary = true,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  dangerActionLabel,
  onDangerAction,
  dangerActionDisabled = false,
  dangerActionDisabledHint = "Нельзя удалить проверенное задание",
}) {
  const safeDeadline = DEADLINE_TONES.includes(deadlineTone) ? deadlineTone : "default";
  const safeProgress = PROGRESS_TONES.includes(progressTone) ? progressTone : "default";
  const pct = Math.max(0, Math.min(100, progressPercent));
  const resolvedCoverVariant = coverVariant || pickCoverVariant(title);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const menuOpen = Boolean(menuAnchor);
  const menuId = useId();

  return (
    <article className="cb-hw-card">
      <HomeworkCover
        deadlineLabel={deadlineLabel}
        deadlineTone={safeDeadline}
        coverImageUrl={coverImageUrl}
        coverBgColor={coverBgColor}
        coverVariant={resolvedCoverVariant}
      />

      <div className="cb-hw-card__body">
        <div className="cb-hw-card__content">
          {subject ? (
            <span className="cb-hw-card__subject">{subject}</span>
          ) : null}

          <h3 className="cb-hw-card__title">{title}</h3>

          {description ? (
            <p className="cb-hw-card__desc">{description}</p>
          ) : null}
        </div>

        <div className="cb-hw-card__bottom">
          {progressLabel ? (
            <div className={`cb-hw-card__progress${hideProgressBar ? " cb-hw-card__progress--text-only" : ""}`}>
              <span className={`cb-hw-card__progress-label cb-hw-card__progress-label--${safeProgress}`}>
                {progressLabel}
              </span>
              {!hideProgressBar ? (
                <div className="cb-hw-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                  <div
                    className={`cb-hw-bar__fill cb-hw-bar__fill--${safeProgress}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="cb-hw-card__footer">
            {(students.length > 0 || overflowCount > 0) ? (
              <div className="cb-hw-avatars">
                {students.slice(0, 3).map((s, i) => (
                  <div key={`${s.initials}-${i}`} className="cb-hw-avatars__item" title={s.initials}>
                    {s.initials}
                  </div>
                ))}
                {overflowCount > 0 ? (
                  <div className="cb-hw-avatars__item cb-hw-avatars__item--more">
                    +
                    {overflowCount}
                  </div>
                ) : null}
              </div>
            ) : (
              <span className="cb-hw-card__footer-spacer" aria-hidden="true" />
            )}

            <div className="cb-hw-card__footer-actions">
              {dangerActionLabel ? (
                <div className="cb-hw-card__more">
                  <button
                    type="button"
                    className="cb-hw-card__more-btn"
                    aria-label="Ещё действия"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    aria-controls={menuId}
                    onClick={(e) => setMenuAnchor(menuOpen ? null : e.currentTarget)}
                  >
                    ⋯
                  </button>
                  <CabinetFloatingMenu
                    open={menuOpen}
                    anchorEl={menuAnchor}
                    onClose={() => setMenuAnchor(null)}
                    className="cb-hw-card__menu"
                    width={168}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      id={menuId}
                      className="cb-hw-card__menu-item cb-hw-card__menu-item--danger"
                      disabled={dangerActionDisabled}
                      title={dangerActionDisabled ? dangerActionDisabledHint : undefined}
                      onClick={() => {
                        if (dangerActionDisabled) return;
                        setMenuAnchor(null);
                        onDangerAction?.();
                      }}
                    >
                      {dangerActionLabel}
                    </button>
                  </CabinetFloatingMenu>
                </div>
              ) : null}
              {secondaryActionLabel ? (
                <button
                  type="button"
                  className="cb-hw-card__btn cb-hw-card__btn--secondary"
                  onClick={onSecondaryAction}
                >
                  {secondaryActionLabel}
                </button>
              ) : null}
              <button
                type="button"
                className={`cb-hw-card__btn${actionPrimary ? " cb-hw-card__btn--primary" : " cb-hw-card__btn--secondary"}`}
                onClick={onAction}
              >
                {actionLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

/** Демо-данные для превью / Storybook / будущей интеграции */
export const HOMEWORK_CARD_EXAMPLES = [
  {
    id: "hw1",
    coverType: "exam",
    deadlineLabel: "До 24 июня",
    deadlineTone: "default",
    subject: "ОГЭ · Информатика",
    title: "Домашнее задание №7",
    description: "12 задач · группа ОГЭ-2026",
    progressLabel: "5 из 8 выполнили",
    progressPercent: 62,
    progressTone: "default",
    students: [{ initials: "ИП" }, { initials: "ОС" }, { initials: "ДВ" }],
    overflowCount: 5,
    actionLabel: "Открыть",
    actionPrimary: true,
  },
  {
    id: "hw2",
    coverType: "exam",
    deadlineLabel: "На проверке",
    deadlineTone: "review",
    subject: "ЕГЭ · №14",
    title: "Системы счисления",
    description: "3 ответа ожидают проверки",
    progressLabel: "3 работы на проверке",
    progressPercent: 75,
    progressTone: "review",
    students: [{ initials: "АМ" }, { initials: "ЕР" }],
    actionLabel: "Проверить",
    actionPrimary: true,
  },
  {
    id: "hw3",
    coverType: "logic",
    deadlineLabel: "Черновик",
    deadlineTone: "draft",
    subject: "ОГЭ · Логика",
    title: "Таблицы истинности",
    description: "Не выдано ученикам",
    progressLabel: "0 из 8 выполнили",
    progressPercent: 0,
    progressTone: "default",
    actionLabel: "Выдать",
    actionPrimary: true,
  },
  {
    id: "hw4",
    coverType: "python",
    deadlineLabel: "Просрочено",
    deadlineTone: "overdue",
    subject: "Python · Практика",
    title: "Рекурсивные функции",
    description: "Выдано индивидуальным ученикам",
    progressLabel: "2 из 5 выполнили",
    progressPercent: 40,
    progressTone: "overdue",
    students: [{ initials: "НЛ" }],
    overflowCount: 2,
    actionLabel: "Открыть",
    actionPrimary: true,
  },
  {
    id: "hw5",
    coverType: "general",
    deadlineLabel: "Завершено",
    deadlineTone: "completed",
    subject: "ЕГЭ · Информатика",
    title: "Домашнее задание №3",
    description: "Все ответы проверены",
    progressLabel: "8 из 8 выполнили",
    progressPercent: 100,
    progressTone: "completed",
    students: [{ initials: "АМ" }, { initials: "МК" }, { initials: "СТ" }],
    actionLabel: "Открыть",
    actionPrimary: true,
  },
];
