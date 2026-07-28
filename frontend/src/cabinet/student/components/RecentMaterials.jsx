import { Link } from "react-router-dom";
import CabinetIcon from "../../CabinetIcons";
import { formatStudentDate } from "../StudentSectionUi";

function materialHref(item) {
  if (item.type === "board") {
    return item.board_url || (item.board_id ? `/cabinet/boards/${item.board_id}` : "");
  }
  return item.external_url || item.file_url || "";
}

function MaterialCard({ item }) {
  const href = materialHref(item);
  const lessonFallback = item.assignment_id
    ? `/cabinet/student/lessons/${item.assignment_id}`
    : "/cabinet/student/materials";
  const subject = item.student_subject_label || "";
  const meta = [
    subject,
    item.type_label,
    item.updated_at || item.assigned_at
      ? formatStudentDate(item.updated_at || item.assigned_at)
      : "",
  ].filter(Boolean).join(" · ");

  const openControl = href ? (
    item.external_url && item.type !== "board" ? (
      <a href={href} className="cb-btn cb-btn--outline cb-btn--sm" target="_blank" rel="noreferrer">
        Открыть
      </a>
    ) : href.startsWith("/") ? (
      <Link to={href} className="cb-btn cb-btn--outline cb-btn--sm">Открыть</Link>
    ) : (
      <a href={href} className="cb-btn cb-btn--outline cb-btn--sm">Открыть</a>
    )
  ) : (
    <Link to={lessonFallback} className="cb-btn cb-btn--outline cb-btn--sm">Открыть</Link>
  );

  return (
    <article className="st-dash-material-card">
      <div className="st-dash-material-card__icon" aria-hidden="true">
        <CabinetIcon name="folder" />
      </div>
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
        <MaterialCard key={`${item.id}-${item.direct ? "d" : "l"}`} item={item} />
      ))}
    </div>
  );
}
