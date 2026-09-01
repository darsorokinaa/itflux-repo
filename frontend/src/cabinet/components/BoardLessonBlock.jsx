import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import BoardCreateModal from "./BoardCreateModal";
import CabinetModal from "./CabinetModal";
import {
  fetchInteractiveBoards,
  normalizeCabinetList,
  updateInteractiveBoard,
} from "../../utils/cabinetAuth";

/** Numeric pk from API id or local-{pk} schedule event ids. */
function toNumericId(value) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  if (text.startsWith("local-")) {
    const n = Number(text.slice(6));
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/**
 * Блок «Интерактивная доска» для карточки занятия / урока.
 * В режиме встречи учитель может «Показать ученику» (onShowToStudent).
 */
export default function BoardLessonBlock({
  scheduleEventId = null,
  lessonId = null,
  lessonTitle = "",
  studentId = null,
  groupId = null,
  studentMode = false,
  onShowToStudent = null,
  onHideFromStudent = null,
  /** Открыть доску у себя со свёрнутым звонком (во время встречи). */
  onOpenLocally = null,
  showingToStudent = false,
  showBusy = false,
  /** Внутри «Материалы урока» — без отдельного заголовка секции */
  embedded = false,
  onPresenceChange = null,
}) {
  const navigate = useNavigate();
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showPick, setShowPick] = useState(false);
  const [catalog, setCatalog] = useState([]);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");

  const eventPk = toNumericId(scheduleEventId);
  const lessonPk = toNumericId(lessonId);

  const loadAttached = useCallback(async () => {
    if (!eventPk && !lessonPk) {
      setBoard(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const params = {};
      if (eventPk) params.schedule_event = eventPk;
      else if (lessonPk) params.lesson = lessonPk;
      const data = await fetchInteractiveBoards(params);
      const list = normalizeCabinetList(data);
      setBoard(list[0] || null);
    } catch (err) {
      setError(err?.message || "Не удалось загрузить доску");
      setBoard(null);
    } finally {
      setLoading(false);
    }
  }, [eventPk, lessonPk]);

  useEffect(() => {
    loadAttached();
  }, [loadAttached]);

  useEffect(() => {
    if (typeof onPresenceChange !== "function") return;
    onPresenceChange({ loading, board });
  }, [loading, board, onPresenceChange]);

  const openPicker = async () => {
    setShowPick(true);
    setPicking(true);
    try {
      const data = await fetchInteractiveBoards();
      setCatalog(normalizeCabinetList(data));
    } catch (err) {
      setError(err?.message || "Не удалось загрузить список досок");
    } finally {
      setPicking(false);
    }
  };

  const attachBoard = async (item) => {
    try {
      const payload = {};
      if (eventPk) payload.schedule_event_id = eventPk;
      if (lessonPk) payload.lesson_id = lessonPk;
      const sid = toNumericId(studentId);
      const gid = toNumericId(groupId);
      if (sid) payload.student_id = sid;
      if (gid) payload.group_id = gid;
      const updated = await updateInteractiveBoard(item.id, payload);
      setShowPick(false);
      setBoard(updated || item);
    } catch (err) {
      setError(err?.message || "Не удалось прикрепить доску");
    }
  };

  // Если доска уже на уроке, но ученик не привязан — привязываем автоматически.
  useEffect(() => {
    if (studentMode || !board?.id) return;
    const sid = toNumericId(studentId);
    if (!sid) return;
    if (board.student_id || board.studentId) return;
    let cancelled = false;
    updateInteractiveBoard(board.id, {
      student_id: sid,
      ...(eventPk ? { schedule_event_id: eventPk } : {}),
    })
      .then((updated) => {
        if (!cancelled && updated) setBoard(updated);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [board, studentId, studentMode, eventPk]);

  if (studentMode && !board && !loading) {
    return null;
  }

  const btnPrimary = embedded
    ? "video-lesson-btn video-lesson-btn--primary"
    : "cb-lesson-card__meeting-btn cb-lesson-card__meeting-btn--primary";
  const btnSecondary = embedded
    ? "video-lesson-btn video-lesson-btn--primary"
    : "cb-lesson-card__meeting-btn";

  const body = (
    <>
      {loading ? (
        <p className="cb-lesson-card__meeting-empty">Загрузка…</p>
      ) : board ? (
        <div className={embedded ? "vl-mat-item" : "cb-board-lesson__row"}>
          {embedded ? (
            <>
              <div className="vl-mat-item__main">
                <div className="vl-mat-item__body">
                  <div className="vl-mat-item__title">{board.title || "Доска"}</div>
                  <div className="vl-mat-item__meta">
                    Интерактивная доска
                    {typeof onShowToStudent === "function" ? (
                      <span className={`vl-mat-item__vis ${showingToStudent ? "is-on" : "is-off"}`}>
                        {showingToStudent ? "Показан ученику" : "Скрыт от ученика"}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="vl-mat-item__actions">
                <button
                  type="button"
                  className={btnPrimary}
                  onClick={() => {
                    if (typeof onOpenLocally === "function") {
                      onOpenLocally(board);
                      return;
                    }
                    if (typeof onShowToStudent === "function") {
                      window.open(`/cabinet/boards/${board.id}`, "_blank");
                      return;
                    }
                    navigate(`/cabinet/boards/${board.id}`);
                  }}
                >
                  Открыть
                </button>
                {typeof onShowToStudent === "function" ? (
                  showingToStudent && typeof onHideFromStudent === "function" ? (
                    <button
                      type="button"
                      className={btnSecondary}
                      disabled={showBusy}
                      aria-pressed="true"
                      onClick={() => onHideFromStudent()}
                    >
                      {showBusy ? "…" : "Скрыть"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={btnSecondary}
                      disabled={showBusy}
                      aria-pressed="false"
                      onClick={() => onShowToStudent(board)}
                    >
                      {showBusy ? "…" : "Показать"}
                    </button>
                  )
                ) : null}
                <button type="button" className={btnSecondary} onClick={openPicker}>
                  Другая
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="cb-board-lesson__name">{board.title || "Доска"}</span>
              <button
                type="button"
                className={btnPrimary}
                onClick={() => {
                  if (typeof onOpenLocally === "function") {
                    onOpenLocally(board);
                    return;
                  }
                  if (typeof onShowToStudent === "function") {
                    window.open(`/cabinet/boards/${board.id}`, "_blank");
                    return;
                  }
                  navigate(`/cabinet/boards/${board.id}`);
                }}
              >
                Открыть
              </button>
              {typeof onShowToStudent === "function" ? (
                showingToStudent && typeof onHideFromStudent === "function" ? (
                  <button
                    type="button"
                    className={btnSecondary}
                    disabled={showBusy}
                    onClick={() => onHideFromStudent()}
                  >
                    {showBusy ? "…" : "Скрыть"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={btnSecondary}
                    disabled={showBusy}
                    onClick={() => onShowToStudent(board)}
                  >
                    {showBusy ? "Показ…" : "Показать ученику"}
                  </button>
                )
              ) : null}
              <button type="button" className={btnSecondary} onClick={openPicker}>
                Выбрать другую
              </button>
            </>
          )}
        </div>
      ) : !studentMode ? (
        <div className={embedded ? "vl-mat-item" : "cb-board-lesson__row"}>
          {embedded ? (
            <>
              <div className="vl-mat-item__main">
                <div className="vl-mat-item__body">
                  <div className="vl-mat-item__title">Интерактивная доска</div>
                  <div className="vl-mat-item__meta">Не прикреплена</div>
                </div>
              </div>
              <div className="vl-mat-item__actions">
                <button
                  type="button"
                  className={btnPrimary}
                  onClick={() => setShowCreate(true)}
                >
                  Создать
                </button>
                <button type="button" className={btnSecondary} onClick={openPicker}>
                  Выбрать
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="cb-lesson-card__meeting-empty" style={{ margin: 0, flex: "1 1 100%" }}>
                Доска не прикреплена
              </p>
              <button
                type="button"
                className={btnPrimary}
                onClick={() => setShowCreate(true)}
              >
                Создать новую
              </button>
              <button type="button" className={btnSecondary} onClick={openPicker}>
                Выбрать существующую
              </button>
            </>
          )}
        </div>
      ) : (
        <p className="cb-lesson-card__meeting-empty">Доска пока недоступна</p>
      )}

      {error ? <p className="cb-board-form__error">{error}</p> : null}

      {showCreate ? (
        <BoardCreateModal
          initial={{
            title: String(lessonTitle || "").trim(),
            scheduleEventId: eventPk,
            lessonId: lessonPk,
            studentId: toNumericId(studentId),
            groupId: toNumericId(groupId),
          }}
          onClose={() => setShowCreate(false)}
          onCreated={(created) => {
            setShowCreate(false);
            setBoard(created);
            if (typeof onShowToStudent !== "function") {
              navigate(`/cabinet/boards/${created.id}`);
            }
          }}
        />
      ) : null}

      {showPick ? (
        <CabinetModal
          title="Выбрать доску"
          onClose={() => setShowPick(false)}
          wide
        >
          {picking ? (
            <p className="cabinet-auth-muted">Загрузка…</p>
          ) : catalog.length === 0 ? (
            <p className="cabinet-auth-muted">У вас пока нет досок</p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
              {catalog.map((item) => (
                <li
                  key={item.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                    alignItems: "center",
                    padding: "0.65rem 0.75rem",
                    border: "1px solid var(--border-card)",
                    borderRadius: 10,
                  }}
                >
                  <span>{item.title || "Без названия"}</span>
                  <button
                    type="button"
                    className="cb-btn cb-btn--primary"
                    onClick={() => attachBoard(item)}
                  >
                    Прикрепить
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CabinetModal>
      ) : null}
    </>
  );

  if (embedded) {
    return <div className="cb-board-lesson cb-board-lesson--embedded">{body}</div>;
  }

  return (
    <section className="cb-lesson-card__section cb-lesson-card__section--compact cb-board-lesson">
      <h3 className="cb-lesson-card__section-title cb-lesson-card__section-title--plain">
        Интерактивная доска
      </h3>
      {body}
    </section>
  );
}
