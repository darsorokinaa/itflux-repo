import { useCallback, useState } from "react";
import CabinetModal from "./CabinetModal";
import PlanItemDetailModal from "./PlanItemDetailModal";
import { planExamLabel, planSubjectLabel } from "../lessonPlansData";

function PreviewSessionCard({ item, plan, onOpen }) {
  const subject = planSubjectLabel(plan.direction);
  const exam = planExamLabel(plan);
  const meta = [exam, subject].filter(Boolean).join(" · ");
  const materialsCount = item.materials?.length || 0;
  const hasHomework = Boolean(item.homeworkDescription?.trim())
    || (item.homeworkMaterials?.length || 0) > 0
    || (item.homeworkInteractives?.length || 0) > 0;
  const coverTone = plan.direction || "other";

  const handleKeyDown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(item);
    }
  };

  return (
    <article
      className="cb-lesson-list-card"
      onClick={() => onOpen(item)}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`Открыть занятие ${item.order}: ${item.title}`}
    >
      <div className={`cb-lesson-list-card__cover cb-lesson-list-card__cover--${coverTone}`}>
        <span className="cb-lesson-list-card__order">{item.order}</span>
      </div>
      <div className="cb-lesson-list-card__body">
        <div className="cb-lesson-list-card__head">
          <h4 className="cb-lesson-list-card__title">{item.title}</h4>
        </div>
        {item.topic ? (
          <p className="cb-lesson-list-card__topic">Тема: {item.topic}</p>
        ) : null}
        {meta ? <p className="cb-lesson-list-card__meta">{meta}</p> : null}
        <div className="cb-lesson-list-card__stats">
          {materialsCount > 0 ? <span>Материалы: {materialsCount}</span> : null}
          <span>ДЗ: {hasHomework ? "есть" : "нет"}</span>
        </div>
      </div>
      <span className="cb-lesson-list-card__action">Открыть</span>
    </article>
  );
}

export default function PlanEditorPreviewModal({ plan, onClose }) {
  const [selectedItem, setSelectedItem] = useState(null);

  const handleOpenItem = useCallback((item) => {
    setSelectedItem(item);
  }, []);

  const handleCloseItem = useCallback(() => {
    setSelectedItem(null);
  }, []);

  const items = plan.items || [];
  const subject = planSubjectLabel(plan.direction);
  const exam = planExamLabel(plan);

  return (
    <>
      <CabinetModal
        title="Предпросмотр плана"
        wide
        onClose={onClose}
        footer={(
          <div className="cb-pe-preview__footer">
            <button type="button" className="cb-btn cb-btn--ghost" onClick={onClose}>
              Закрыть
            </button>
          </div>
        )}
      >
        <div className="cb-pe-preview">
          <header className="cb-pe-preview__head">
            <h3 className="cb-pe-preview__title">{plan.title}</h3>
            <div className="cb-pe-preview__meta">
              {exam ? <span className="cb-plan-meta-badge cb-plan-meta-badge--info">{exam}</span> : null}
              {subject ? <span className="cb-plan-meta-badge cb-plan-meta-badge--lav">{subject}</span> : null}
              {plan.grade ? (
                <span className="cb-plan-meta-badge cb-plan-meta-badge--gray">{plan.grade} класс</span>
              ) : null}
            </div>
            {plan.goal?.trim() ? (
              <p className="cb-pe-preview__goal">{plan.goal.trim()}</p>
            ) : null}
            {plan.description?.trim() ? (
              <p className="cb-pe-preview__desc">{plan.description.trim()}</p>
            ) : null}
          </header>

          {items.length === 0 ? (
            <p className="cb-pe-preview__empty">Добавьте занятия, чтобы увидеть их в предпросмотре.</p>
          ) : (
            <div className="cb-pe-preview__list">
              {items.map((item) => (
                <PreviewSessionCard
                  key={item.order}
                  item={item}
                  plan={plan}
                  onOpen={handleOpenItem}
                />
              ))}
            </div>
          )}
        </div>
      </CabinetModal>

      {selectedItem ? (
        <PlanItemDetailModal
          initialItem={selectedItem}
          plan={plan}
          canEdit={false}
          onClose={handleCloseItem}
        />
      ) : null}
    </>
  );
}
