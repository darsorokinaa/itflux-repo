import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import CabinetIcon from "../CabinetIcons";
import CabinetModal from "./CabinetModal";

const GUIDE_STEPS = [
  {
    id: "students",
    title: "Как добавить ученика и группу",
    icon: "students",
    description: "Сначала добавьте учеников, затем соберите их в группу для выдачи общих заданий.",
    checklist: [
      "Откройте раздел «Ученики».",
      "Нажмите «Добавить ученика» и отправьте приглашение.",
      "Создайте группу и закрепите в ней учеников.",
    ],
    links: [
      { label: "Перейти в «Ученики»", to: "/cabinet/students" },
    ],
  },
  {
    id: "plans",
    title: "Как добавить план урока",
    icon: "plan",
    description: "План задает структуру занятия: этапы урока, материалы, задания и домашнюю работу.",
    checklist: [
      "Перейдите в «Планы уроков».",
      "Нажмите «Создать план».",
      "Добавьте этапы, задания и материалы в карточки плана.",
    ],
    links: [
      { label: "Открыть «Планы уроков»", to: "/cabinet/plans" },
      { label: "Сразу создать план", to: "/cabinet/plans/new" },
    ],
  },
  {
    id: "bind-plan",
    title: "Как привязать план к уроку",
    icon: "calendar",
    description: "План привязывается при создании или редактировании события в расписании.",
    checklist: [
      "Откройте «Календарь».",
      "Нажмите «+ Урок» или откройте существующее событие.",
      "Выберите план урока в карточке события.",
    ],
    links: [
      { label: "Открыть «Календарь»", to: "/cabinet/schedule" },
    ],
  },
  {
    id: "calendar",
    title: "Как пользоваться календарем",
    icon: "calendar",
    description: "В календаре можно планировать занятия по дням/неделям, открывать карточку урока и запускать урок.",
    checklist: [
      "Выберите режим: день, неделя, месяц или список.",
      "Кликните по событию, чтобы открыть карточку урока.",
      "Из карточки переходите к материалам и управлению уроком.",
    ],
    links: [
      { label: "Перейти в календарь", to: "/cabinet/schedule" },
      { label: "Открыть список уроков", to: "/cabinet/lessons" },
    ],
  },
  {
    id: "interactives",
    title: "Как пользоваться интерактивами",
    icon: "interactives",
    description: "В разделе интерактивов можно создавать тренажеры, редактировать их и выдавать ученикам.",
    checklist: [
      "Откройте «Интерактивы».",
      "Нажмите «Создать» и выберите тип интерактива.",
      "Заполните контент, сохраните и назначьте ученику/группе.",
    ],
    links: [
      { label: "Открыть «Интерактивы»", to: "/cabinet/interactives" },
      { label: "Создать интерактив", to: "/cabinet/interactives/new" },
    ],
  },
  {
    id: "task-bank",
    title: "Как пользоваться банком задач",
    icon: "tasks",
    description: "Банк задач открывается в отдельной вкладке и нужен для подбора заданий по фильтрам.",
    checklist: [
      "Откройте «Банк задач» в меню слева.",
      "Выберите экзамен, тему и подтему.",
      "Используйте задачи при подготовке уроков и материалов.",
    ],
    links: [
      { label: "Открыть «Банк задач»", to: "/tasks", newTab: true },
    ],
  },
  {
    id: "lesson-card",
    title: "Как смотреть карточку урока",
    icon: "lessons",
    description: "Карточка урока открывается из расписания или списка уроков и показывает все детали занятия.",
    checklist: [
      "Перейдите в «Календарь» или «Уроки».",
      "Нажмите на событие/кнопку «Открыть».",
      "В карточке смотрите тему, материалы, задания и действия по уроку.",
    ],
    links: [
      { label: "Открыть календарь", to: "/cabinet/schedule" },
      { label: "Открыть уроки", to: "/cabinet/lessons" },
    ],
  },
];

export default function CabinetGuideModal({ open, onClose, onComplete }) {
  const navigate = useNavigate();
  const [stepIndex, setStepIndex] = useState(0);
  const total = GUIDE_STEPS.length;
  const progressPercent = useMemo(
    () => Math.round(((stepIndex + 1) / total) * 100),
    [stepIndex, total],
  );
  const current = GUIDE_STEPS[stepIndex];
  const isLast = stepIndex === total - 1;

  useEffect(() => {
    if (open) setStepIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") {
        setStepIndex((prev) => Math.min(prev + 1, total - 1));
      }
      if (event.key === "ArrowLeft") {
        setStepIndex((prev) => Math.max(prev - 1, 0));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open, total]);

  if (!open) return null;

  const openLink = (item) => {
    if (!item?.to) return;
    if (item.newTab) {
      window.open(item.to, "_blank", "noopener,noreferrer");
    } else {
      navigate(item.to);
    }
    onClose();
  };

  const footer = (
    <div className="cb-guide-modal__footer">
      <button type="button" className="cb-btn cb-btn--ghost cb-btn--sm" onClick={onClose}>
        Пропустить
      </button>
      <div className="cb-guide-modal__footer-main">
        <button
          type="button"
          className="cb-btn cb-btn--outline cb-btn--sm"
          onClick={() => setStepIndex((prev) => Math.max(prev - 1, 0))}
          disabled={stepIndex === 0}
        >
          Назад
        </button>
        {isLast ? (
          <button type="button" className="cb-btn cb-btn--primary cb-btn--sm" onClick={onComplete}>
            Завершить
          </button>
        ) : (
          <button
            type="button"
            className="cb-btn cb-btn--primary cb-btn--sm"
            onClick={() => setStepIndex((prev) => Math.min(prev + 1, total - 1))}
          >
            Далее
          </button>
        )}
      </div>
    </div>
  );

  return (
    <CabinetModal
      title="Интерактивная инструкция по кабинету"
      onClose={onClose}
      wide
      footer={footer}
    >
      <div className="cb-guide-modal">
        <div className="cb-guide-modal__progress">
          <span className="cb-guide-modal__counter">{stepIndex + 1} из {total}</span>
          <div
            className="cb-guide-modal__progress-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPercent}
            aria-label="Прогресс инструкции"
          >
            <span style={{ width: `${progressPercent}%` }} />
          </div>
        </div>

        <div className="cb-guide-modal__hero">
          <span className="cb-guide-modal__icon" aria-hidden="true">
            <CabinetIcon name={current.icon} />
          </span>
          <div className="cb-guide-modal__hero-content">
            <h3 className="cb-guide-modal__title">{current.title}</h3>
            <p className="cb-guide-modal__description">{current.description}</p>
          </div>
        </div>

        <ul className="cb-guide-modal__checklist">
          {current.checklist.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>

        <div className="cb-guide-links">
          {current.links.map((item) => (
            <button
              key={`${current.id}-${item.label}`}
              type="button"
              className="cb-guide-link"
              onClick={() => openLink(item)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="cb-guide-steps" role="tablist" aria-label="Шаги инструкции">
          {GUIDE_STEPS.map((step, index) => (
            <button
              key={step.id}
              type="button"
              role="tab"
              aria-selected={index === stepIndex}
              className={`cb-guide-step${index === stepIndex ? " is-active" : ""}`}
              onClick={() => setStepIndex(index)}
            >
              <span className="cb-guide-step__num">{index + 1}</span>
              <span className="cb-guide-step__text">{step.title}</span>
            </button>
          ))}
        </div>
      </div>
    </CabinetModal>
  );
}
