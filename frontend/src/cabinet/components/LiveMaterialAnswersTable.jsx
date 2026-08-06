/**
 * Таблица live-ответов учеников по material session (не variant).
 * state.answers / state.fields: { [userId]: { [itemId]: { value, status, updated_at, typing } } }
 */
import { useMemo } from "react";

export function buildMaterialAnswerRows(state, presence = []) {
  const answers = state?.answers && typeof state.answers === "object" ? state.answers : {};
  const fields = state?.fields && typeof state.fields === "object" ? state.fields : {};
  const names = new Map(
    (presence || []).map((p) => [String(p.userId ?? p.user_id), p.displayName || p.display_name || "Ученик"]),
  );

  const userIds = new Set([...Object.keys(answers), ...Object.keys(fields)]);
  const rows = [];
  for (const userId of userIds) {
    const ansBucket = answers[userId] && typeof answers[userId] === "object" ? answers[userId] : {};
    const fieldBucket = fields[userId] && typeof fields[userId] === "object" ? fields[userId] : {};
    const sample = Object.values(ansBucket)[0];
    if (sample && typeof sample === "object" && !("value" in sample) && !("author_id" in sample)) {
      continue;
    }
    const items = { ...fieldBucket, ...ansBucket };
    const entries = Object.entries(items).filter(([, row]) => row && typeof row === "object");
    if (!entries.length) continue;
    let latest = 0;
    let answering = false;
    let typing = false;
    const preview = entries.slice(0, 8).map(([id, row]) => {
      const ts = Date.parse(row.updated_at || row.updatedAt || "") || 0;
      if (ts > latest) latest = ts;
      if (row.status === "draft") answering = true;
      if (row.typing) typing = true;
      const val = row.value;
      const text = val == null ? "—" : (typeof val === "string" ? val : JSON.stringify(val));
      return {
        id,
        text: text.slice(0, 120),
        status: row.status || "draft",
        typing: Boolean(row.typing),
        attempt: row.attempt || 1,
      };
    });
    rows.push({
      userId,
      name: names.get(String(userId)) || `Ученик ${userId}`,
      count: entries.length,
      answering,
      typing,
      latestAt: latest || null,
      preview,
      status: answering ? "draft" : (entries.some(([, r]) => r.status === "submitted") ? "submitted" : "draft"),
    });
  }
  rows.sort((a, b) => (b.latestAt || 0) - (a.latestAt || 0));
  return rows;
}

function formatTime(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "—";
  }
}

export default function LiveMaterialAnswersTable({
  state,
  presence = [],
  loading = false,
  compact = false,
  onCheckAnswer = null,
  onShowHint = null,
  onResetAnswer = null,
}) {
  const rows = useMemo(() => buildMaterialAnswerRows(state, presence), [state, presence]);

  if (loading) {
    return <div className="video-lesson-live-answers__empty">Загрузка ответов…</div>;
  }
  if (!rows.length) {
    return (
      <div className="video-lesson-live-answers__empty">
        Пока нет ответов учеников. Они появятся здесь в реальном времени.
      </div>
    );
  }

  return (
    <div className={`video-lesson-live-answers${compact ? " is-compact" : ""}`}>
      <div className="video-lesson-live-answers__head">
        <strong>Ответы учеников</strong>
        <span>{rows.length}</span>
      </div>
      <div className="video-lesson-live-answers__table-wrap">
        <table className="video-lesson-live-answers__table">
          <thead>
            <tr>
              <th>Ученик</th>
              <th>Статус</th>
              <th>Ответы</th>
              <th>Обновлено</th>
              {(onCheckAnswer || onShowHint || onResetAnswer) ? <th>Действия</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.userId}>
                <td>{row.name}</td>
                <td>
                  {row.typing ? (
                    <span className="video-lesson-live-answers__ok">печатает…</span>
                  ) : row.answering ? (
                    <span className="video-lesson-live-answers__ok">отвечает сейчас</span>
                  ) : row.status === "submitted" ? (
                    "отправлено"
                  ) : (
                    "черновик"
                  )}
                </td>
                <td>
                  <ul className="video-lesson-live-answers__list">
                    {row.preview.map((p) => (
                      <li key={p.id}>
                        <span className="video-lesson-live-answers__q">{p.id}</span>
                        <span className="video-lesson-live-answers__a">{p.text}</span>
                        {p.typing ? <span className="video-lesson-live-answers__ok"> · …</span> : null}
                      </li>
                    ))}
                    {row.count > row.preview.length ? (
                      <li>…ещё {row.count - row.preview.length}</li>
                    ) : null}
                  </ul>
                </td>
                <td>{formatTime(row.latestAt)}</td>
                {(onCheckAnswer || onShowHint || onResetAnswer) ? (
                  <td>
                    <div className="video-lesson-live-answers__actions">
                      {onCheckAnswer ? (
                        <button type="button" className="video-lesson-btn video-lesson-btn--ghost" onClick={() => onCheckAnswer(row)}>
                          Проверить
                        </button>
                      ) : null}
                      {onShowHint ? (
                        <button type="button" className="video-lesson-btn video-lesson-btn--ghost" onClick={() => onShowHint(row)}>
                          Подсказка
                        </button>
                      ) : null}
                      {onResetAnswer ? (
                        <button type="button" className="video-lesson-btn video-lesson-btn--ghost" onClick={() => onResetAnswer(row)}>
                          Сбросить
                        </button>
                      ) : null}
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
