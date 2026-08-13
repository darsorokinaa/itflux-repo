import { Link } from "react-router-dom";
import { formatStudentDate } from "../StudentSectionUi";
import { getMaterialTypeConfig, materialTypeLabel } from "../../materialTypeConfig";
import { StudentMaterialThumb, isMaterialPreviewable } from "./StudentMaterialPreview";

function materialHref(item) {
  if (item.type === "interactive") {
    return item.interactive_url
      || (item.interactive_assignment_id
        ? `/cabinet/student/interactives/${item.interactive_assignment_id}/play`
        : "");
  }
  if (item.type === "board") {
    return item.board_url || (item.board_id ? `/cabinet/boards/${item.board_id}` : "");
  }
  return item.external_url || item.file_url || "";
}

function MaterialCard({ item }) {
  const previewable = isMaterialPreviewable(item);
  const href = previewable ? item.preview_url : materialHref(item);
  const cfg = getMaterialTypeConfig(item.type);
  const lessonFallback = item.assignment_id
    ? `/cabinet/student/lessons/${item.assignment_id}`
    : item.homework_id
      ? `/cabinet/student/assignments/${item.homework_id}`
      : "/cabinet/student/materials";
  const subject = item.student_subject_label || "";
  const sourceLabel = item.source === "homework"
    ? "Из ДЗ"
    : item.source === "interactive"
      ? "Интерактив"
      : item.direct
        ? "Выдано учителем"
        : "";
  const meta = [
    subject,
    item.type_label ? materialTypeLabel(item.type, item.type_label) : cfg.label,
    item.teacher_name ? `Учитель: ${item.teacher_name}` : "",
    sourceLabel,
    item.updated_at || item.assigned_at
      ? formatStudentDate(item.updated_at || item.assigned_at)
      : "",
  ].filter(Boolean).join(" · ");

  const isInternal = Boolean(href) && (
    item.type === "board" || item.type === "interactive" || href.startsWith("/")
  );
  const openControl = href ? (
    item.external_url && item.type !== "board" && item.type !== "interactive" && !previewable ? (
      <a href={href} className="cb-btn cb-btn--outline cb-btn--sm" target="_blank" rel="noreferrer">
        Открыть
      </a>
    ) : isInternal && !previewable ? (
      <Link to={href} className="cb-btn cb-btn--outline cb-btn--sm">Открыть</Link>
    ) : (
      <a href={href} className="cb-btn cb-btn--outline cb-btn--sm" target="_blank" rel="noreferrer">
        {previewable ? "Просмотр" : "Открыть"}
      </a>
    )
  ) : (
    <Link to={lessonFallback} className="cb-btn cb-btn--outline cb-btn--sm">Открыть</Link>
  );

  return (
    <article className="st-dash-material-card">
      <StudentMaterialThumb item={item} />
      <div className="st-dash-material-card__body">
        <h3 className="st-dash-material-card__title">{item.title}</h3>
        {meta ? <p className="st-dash-material-card__meta">{meta}</p> : null}
      </div>
      {openControl}
    </article>
  );
}

export default function RecentMaterials({ items = [] }) {
  if (!items.length) {
    return (
      <div className="st-dash-empty">
        <p className="st-dash-empty__title">Материалов пока нет</p>
        <p className="st-dash-empty__text">Файлы и ссылки от учителя появятся здесь.</p>
      </div>
    );
  }

  return (
    <div className="st-dash-card-stack">
      {items.slice(0, 3).map((item) => (
        <MaterialCard key={`${item.id}-${item.source || (item.direct ? "d" : "l")}`} item={item} />
      ))}
    </div>
  );
}
