import { isHomeworkAttachmentImage } from "../homeworkAttachmentState";
import { liveTaskAttachments } from "./LiveVariantAnswersTable";
import { withFileIntent } from "./AttachmentPreviewModal";

/** r129: файлы учеников под заданием (вид учителя в live-варианте). */
export function liveStudentsFilesForTask(answers, task) {
  return (answers?.students || [])
    .map((st) => ({ studentId: st.studentId, name: st.displayName || st.name || "Ученик", files: liveTaskAttachments(st.result, task) }))
    .filter((r) => r.files.length);
}

function isImage(f) {
  try {
    if (isHomeworkAttachmentImage(f)) return true;
  } catch {
    /* ignore */
  }
  return /^image\//.test(f.mime_type || "") || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.filename || f.name || "");
}

export default function LiveTaskStudentFiles({ answers, task }) {
  const rows = liveStudentsFilesForTask(answers, task);
  if (!rows.length) return null;
  const multi = (answers?.students || []).length > 1;
  return (
    <div className="lesson-solution-previews live-task-files no-print">
      <span className="lesson-solution-previews__label">Файлы ученика</span>
      {rows.map((r) => (
        <div key={r.studentId} className="live-task-files__row">
          {multi ? <span className="live-task-files__name">{r.name}</span> : null}
          <div className="lesson-solution-previews__grid">
            {r.files.map((f, i) => {
              const src = String(f.url || f.file_url || "");
              const href = withFileIntent(src, "inline") || src;
              const label = f.name || f.filename || `Файл ${i + 1}`;
              return (
                <figure key={f.id || src || i} className="lesson-solution-preview-fig">
                  {isImage(f) ? (
                    <a href={href} target="_blank" rel="noreferrer" className="lesson-solution-preview-link">
                      <img src={src} alt={label} className="lesson-solution-thumb" loading="lazy" />
                    </a>
                  ) : (
                    <a href={href} target="_blank" rel="noreferrer" className="lesson-solution-file-item">
                      <span className="lesson-solution-file-item__icon" aria-hidden="true">📎</span>
                      <span className="lesson-solution-file-item__name">{label}</span>
                    </a>
                  )}
                  <figcaption className="lesson-solution-preview-cap">{label}</figcaption>
                </figure>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
