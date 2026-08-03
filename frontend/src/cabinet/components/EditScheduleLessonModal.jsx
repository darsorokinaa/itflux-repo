import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import CabinetIcon from "../CabinetIcons";
import SeriesScopeModal from "./SeriesScopeModal";
import {
  fetchLessonPlan,
  fetchPlanEnrollments,
  fetchStudentSubjects,
  linkScheduleEventPlanItem,
  setScheduleEventPlanSync,
  syncScheduleEventFromPlan,
  syncScheduleEventToPlan,
  updateScheduleEventContent,
} from "../../utils/cabinetAuth";
import {
  buildScheduleDateTimePayload,
  eventScheduleDate,
  normalizeTimeValue,
} from "../scheduleLessonUtils";

const CONTENT_SOURCE_LABEL = {
  plan: "Из плана обучения",
  manual: "Введено вручную",
  mixed: "Смешанный источник",
};

/** Тема/описание/цель/ДЗ занятия + связь с планом обучения ученика. */
function PlanSyncSection({ event, disabled }) {
  const [topic, setTopic] = useState(event.topic || "");
  const [subtopic, setSubtopic] = useState(event.subtopic || "");
  const [description, setDescription] = useState(event.description || "");
  const [goal, setGoal] = useState(event.goal || "");
  const [homeworkDescription, setHomeworkDescription] = useState(event.homeworkDescription || "");
  // Мета синхронизации ведём локально: ответы sync-эндпоинтов приходят сразу,
  // а полноценный рефреш списка занятий на странице расписания — только после
  // закрытия модалки, поэтому статус/ссылку на план обновляем сами.
  const [syncMeta, setSyncMeta] = useState({
    linkedPlanId: event.linkedPlanId || null,
    linkedPlanTitle: event.linkedPlanTitle || "",
    contentSource: event.contentSource || "manual",
    planSyncEnabled: event.planSyncEnabled !== false,
    planSyncedAt: event.planSyncedAt || null,
  });
  const [conflict, setConflict] = useState(null);
  const [savingContent, setSavingContent] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);
  const [planNotice, setPlanNotice] = useState("");
  const [pickerItems, setPickerItems] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState("");
  const savingRef = useRef(false);

  useEffect(() => {
    setTopic(event.topic || "");
    setSubtopic(event.subtopic || "");
    setDescription(event.description || "");
    setGoal(event.goal || "");
    setHomeworkDescription(event.homeworkDescription || "");
    setSyncMeta({
      linkedPlanId: event.linkedPlanId || null,
      linkedPlanTitle: event.linkedPlanTitle || "",
      contentSource: event.contentSource || "manual",
      planSyncEnabled: event.planSyncEnabled !== false,
      planSyncedAt: event.planSyncedAt || null,
    });
    setConflict(null);
  }, [event.id]);

  const applyServerEvent = (patch) => {
    if (!patch) return;
    if (patch.topic !== undefined) setTopic(patch.topic || "");
    if (patch.subtopic !== undefined) setSubtopic(patch.subtopic || "");
    if (patch.description !== undefined) setDescription(patch.description || "");
    if (patch.goal !== undefined) setGoal(patch.goal || "");
    if (patch.homeworkDescription !== undefined) setHomeworkDescription(patch.homeworkDescription || "");
    setSyncMeta((prev) => ({
      linkedPlanId: patch.linkedPlanId !== undefined ? patch.linkedPlanId : prev.linkedPlanId,
      linkedPlanTitle: patch.linkedPlanTitle !== undefined ? patch.linkedPlanTitle : prev.linkedPlanTitle,
      contentSource: patch.contentSource !== undefined ? patch.contentSource : prev.contentSource,
      planSyncEnabled: patch.planSyncEnabled !== undefined ? patch.planSyncEnabled : prev.planSyncEnabled,
      planSyncedAt: patch.planSyncedAt !== undefined ? patch.planSyncedAt : prev.planSyncedAt,
    }));
  };

  const isGroup = Boolean(event.groupId || event.type === "group" || event.type === "group_lesson");

  useEffect(() => {
    if (syncMeta.linkedPlanId || !event.studentId || isGroup) {
      setPickerItems([]);
      return undefined;
    }
    let cancelled = false;
    setPickerLoading(true);
    fetchPlanEnrollments({ student: event.studentId, status: "active" })
      .then((data) => {
        if (cancelled) return null;
        const list = Array.isArray(data) ? data : data?.results || data?.items || [];
        const enrollment = list[0];
        if (!enrollment?.plan) return null;
        return fetchLessonPlan(enrollment.plan);
      })
      .then((plan) => {
        if (cancelled || !plan) return;
        setPickerItems(Array.isArray(plan.items) ? plan.items : []);
      })
      .catch(() => {
        if (!cancelled) setPickerItems([]);
      })
      .finally(() => {
        if (!cancelled) setPickerLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [event.studentId, syncMeta.linkedPlanId, isGroup]);

  const changedContent = () => {
    const patch = {};
    if (topic !== (event.topic || "")) patch.topic = topic;
    if (subtopic !== (event.subtopic || "")) patch.subtopic = subtopic;
    if (description !== (event.description || "")) patch.description = description;
    if (goal !== (event.goal || "")) patch.goal = goal;
    if (homeworkDescription !== (event.homeworkDescription || "")) patch.homework_description = homeworkDescription;
    return patch;
  };

  const submitContent = async (extra = {}) => {
    const patch = changedContent();
    if (!Object.keys(patch).length && !Object.keys(extra).length) return;
    if (savingRef.current) return;
    savingRef.current = true;
    setSavingContent(true);
    try {
      const data = await updateScheduleEventContent(event.id, { ...patch, ...extra });
      setConflict(null);
      setPlanNotice("");
      applyServerEvent(data?.scheduleEvent);
    } catch (err) {
      if (err?.status === 409 && err?.data?.conflict) {
        setConflict({
          message: err.data.detail || "Тема этого урока отличается от темы в плане обучения.",
          choices: err.data.choices || [],
        });
      } else {
        setPlanNotice(err?.message || "Не удалось сохранить изменения.");
      }
    } finally {
      savingRef.current = false;
      setSavingContent(false);
    }
  };

  const handleResolveConflict = (choiceId) => submitContent({ resolve_conflict: choiceId });

  const handleAddToPlan = async () => {
    setPlanBusy(true);
    setPlanNotice("");
    try {
      const data = await syncScheduleEventToPlan(event.id, { mode: "create_item" });
      applyServerEvent(data?.scheduleEvent);
      setPlanNotice("Тема добавлена в план обучения.");
    } catch (err) {
      if (err?.code === "group_confirm_required") {
        const ok = window.confirm(
          "Это групповое занятие. Добавить тему в планы обучения ВСЕХ участников группы?",
        );
        if (!ok) {
          setPlanBusy(false);
          return;
        }
        try {
          const data = await syncScheduleEventToPlan(event.id, {
            mode: "create_item",
            confirm_all_students: true,
          });
          applyServerEvent(data?.scheduleEvent);
          setPlanNotice("Тема добавлена в планы обучения участников.");
        } catch (err2) {
          setPlanNotice(err2?.message || "Не удалось добавить в план.");
        }
      } else {
        setPlanNotice(err?.message || "Не удалось добавить в план.");
      }
    } finally {
      setPlanBusy(false);
    }
  };

  const handleLinkExisting = async () => {
    if (!selectedItemId) return;
    setPlanBusy(true);
    setPlanNotice("");
    try {
      const data = await linkScheduleEventPlanItem(event.id, Number(selectedItemId));
      applyServerEvent(data?.scheduleEvent);
      setPlanNotice("Урок связан с пунктом плана.");
    } catch (err) {
      setPlanNotice(err?.message || "Не удалось связать с пунктом плана.");
    } finally {
      setPlanBusy(false);
    }
  };

  const handleSyncFromPlan = async () => {
    setPlanBusy(true);
    setPlanNotice("");
    try {
      const data = await syncScheduleEventFromPlan(event.id);
      applyServerEvent(data?.scheduleEvent);
      setPlanNotice("Данные урока обновлены из плана.");
    } catch (err) {
      setPlanNotice(err?.message || "Не удалось обновить из плана.");
    } finally {
      setPlanBusy(false);
    }
  };

  const handleToggleSync = async () => {
    setPlanBusy(true);
    setPlanNotice("");
    try {
      const data = await setScheduleEventPlanSync(event.id, !syncMeta.planSyncEnabled);
      applyServerEvent(data?.scheduleEvent);
    } catch (err) {
      setPlanNotice(err?.message || "Не удалось изменить синхронизацию.");
    } finally {
      setPlanBusy(false);
    }
  };

  return (
    <section className="cb-sch-form__section cb-sch-form__section--plan-sync">
      <h3>Тема и план обучения</h3>

      {syncMeta.linkedPlanId ? (
        <div className="cb-sch-plan-status">
          <span className="cb-sch-plan-status__row">
            План: <Link to={`/cabinet/plans/${syncMeta.linkedPlanId}`} target="_blank" rel="noreferrer">
              {syncMeta.linkedPlanTitle || "Открыть план обучения"}
            </Link>
          </span>
          <span className="cb-sch-plan-status__row">
            Источник: {CONTENT_SOURCE_LABEL[syncMeta.contentSource] || "—"}
            {syncMeta.planSyncedAt ? ` · синхронизировано ${new Date(syncMeta.planSyncedAt).toLocaleString("ru-RU")}` : ""}
          </span>
          <label className="cb-sch-check">
            <input
              type="checkbox"
              checked={Boolean(syncMeta.planSyncEnabled)}
              onChange={handleToggleSync}
              disabled={disabled || planBusy}
            />
            <span>Автоматически обновлять данные из плана обучения</span>
          </label>
          <div className="cb-sch-form__row">
            <button type="button" className="cb-btn cb-btn--outline" disabled={disabled || planBusy} onClick={handleSyncFromPlan}>
              Обновить из плана
            </button>
          </div>
        </div>
      ) : (
        <div className="cb-sch-plan-status">
          <p className="cb-sch-form__hint">Урок пока не связан с планом обучения.</p>
          <div className="cb-sch-form__row">
            <button type="button" className="cb-btn cb-btn--outline" disabled={disabled || planBusy} onClick={handleAddToPlan}>
              Добавить в план обучения
            </button>
            {!isGroup && pickerItems.length ? (
              <>
                <select
                  value={selectedItemId}
                  onChange={(e) => setSelectedItemId(e.target.value)}
                  disabled={disabled || planBusy}
                >
                  <option value="">Связать с пунктом плана…</option>
                  {pickerItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.order ? `${item.order}. ` : ""}{item.topic || item.title}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="cb-btn cb-btn--outline"
                  disabled={disabled || planBusy || !selectedItemId}
                  onClick={handleLinkExisting}
                >
                  Связать
                </button>
              </>
            ) : null}
            {!isGroup && pickerLoading ? <span className="cb-sch-form__hint">Загрузка пунктов плана…</span> : null}
          </div>
        </div>
      )}

      {planNotice ? <p className="cb-sch-form__hint" role="status">{planNotice}</p> : null}

      <label className="cb-sch-field">
        <span>Тема урока</span>
        <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} disabled={disabled} />
      </label>
      <label className="cb-sch-field">
        <span>Подтема</span>
        <input type="text" value={subtopic} onChange={(e) => setSubtopic(e.target.value)} disabled={disabled} />
      </label>
      <label className="cb-sch-field">
        <span>Цель урока</span>
        <textarea rows={2} value={goal} onChange={(e) => setGoal(e.target.value)} disabled={disabled} />
      </label>
      <label className="cb-sch-field">
        <span>Описание</span>
        <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} disabled={disabled} />
      </label>
      <label className="cb-sch-field">
        <span>Домашнее задание</span>
        <textarea rows={2} value={homeworkDescription} onChange={(e) => setHomeworkDescription(e.target.value)} disabled={disabled} />
      </label>

      {conflict ? (
        <div className="cb-sch-form__conflict" role="alert">
          <p>{conflict.message}</p>
          <div className="cb-sch-form__row">
            {(conflict.choices || []).map((choice) => (
              <button
                key={choice.id}
                type="button"
                className="cb-btn cb-btn--outline"
                onClick={() => handleResolveConflict(choice.id)}
                disabled={savingContent}
              >
                {choice.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="cb-sch-form__row">
          <button
            type="button"
            className="cb-btn cb-btn--outline"
            disabled={disabled || savingContent || !Object.keys(changedContent()).length}
            onClick={() => submitContent()}
          >
            {savingContent ? "Сохранение…" : "Сохранить тему/описание"}
          </button>
        </div>
      )}
    </section>
  );
}

export default function EditScheduleLessonModal({ event, onClose, onSave }) {
  const [date, setDate] = useState(eventScheduleDate(event));
  const [startTime, setStartTime] = useState(normalizeTimeValue(event.startTime || "15:00"));
  const [endTime, setEndTime] = useState(normalizeTimeValue(event.endTime || "15:45"));
  const [link, setLink] = useState(event.link || "");
  const [notifyParticipants, setNotifyParticipants] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [scopeOpen, setScopeOpen] = useState(false);
  const [scopeTimeChanged, setScopeTimeChanged] = useState(false);
  const [studentSubjects, setStudentSubjects] = useState([]);
  const [studentSubjectId, setStudentSubjectId] = useState(
    event.studentSubjectId ? String(event.studentSubjectId) : "",
  );
  const savingRef = useRef(false);

  useEffect(() => {
    setDate(eventScheduleDate(event));
    setStartTime(normalizeTimeValue(event.startTime || "15:00"));
    setEndTime(normalizeTimeValue(event.endTime || "15:45"));
    setLink(event.link || "");
    setStudentSubjectId(event.studentSubjectId ? String(event.studentSubjectId) : "");
  }, [event]);

  useEffect(() => {
    if (!event.studentId) {
      setStudentSubjects([]);
      return undefined;
    }
    let cancelled = false;
    fetchStudentSubjects(event.studentId)
      .then((data) => {
        if (cancelled) return;
        const list = (Array.isArray(data) ? data : data?.items || [])
          .filter((s) => s.status !== "archived");
        setStudentSubjects(list);
      })
      .catch(() => {
        if (!cancelled) setStudentSubjects([]);
      });
    return () => { cancelled = true; };
  }, [event.studentId]);

  const buildPayload = () => ({
    title: (event.audience || event.title || "").trim(),
    ...buildScheduleDateTimePayload(date, startTime, endTime),
    telemost_url: link.trim(),
    link: link.trim(),
    notify_participants: notifyParticipants,
    student_subject: studentSubjectId ? Number(studentSubjectId) : null,
    student_subject_id: studentSubjectId ? Number(studentSubjectId) : null,
  });

  const eventTimesUnchanged = () => (
    date === eventScheduleDate(event)
    && normalizeTimeValue(startTime) === normalizeTimeValue(event.startTime || "15:00")
    && normalizeTimeValue(endTime) === normalizeTimeValue(event.endTime || "15:45")
  );

  const submitWithScope = async (scope) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      await onSave({ ...buildPayload(), scope });
      setScopeOpen(false);
      onClose();
    } catch (err) {
      setScopeOpen(false);
      setError(err.message || "Не удалось сохранить изменения.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (savingRef.current) return;
    const hasSeries = Boolean(event.seriesId || event.hasOrphanSeries || event.isRecurring);

    if (hasSeries) {
      setScopeTimeChanged(!eventTimesUnchanged());
      setScopeOpen(true);
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      await onSave(buildPayload());
      onClose();
    } catch (err) {
      setError(err.message || "Не удалось сохранить изменения.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <>
      {!scopeOpen ? (
      <div className="cb-sch-overlay" onClick={saving ? undefined : onClose} role="presentation">
        <div
          className="cb-sch-modal cb-sch-modal--wide"
          onClick={(ev) => ev.stopPropagation()}
          role="dialog"
          aria-labelledby="sch-edit-title"
          aria-busy={saving || undefined}
        >
          <div className="cb-sch-modal__head">
            <h2 id="sch-edit-title">Изменить занятие</h2>
            <button
              type="button"
              className="cb-sch-popover__close"
              onClick={onClose}
              aria-label="Закрыть"
              disabled={saving}
            >
              <CabinetIcon name="close" />
            </button>
          </div>
          <form className="cb-sch-form cb-sch-form--sections" onSubmit={handleSubmit}>
            {error ? <p className="cb-sch-form__error" role="alert">{error}</p> : null}
            {saving ? (
              <p className="cb-sch-form__hint" role="status">Сохранение… Не закрывайте окно.</p>
            ) : null}

            <section className="cb-sch-form__section">
              <h3>Занятие</h3>
              <p className="cb-sch-form__hint">
                {event.audience || event.title || "Участники не указаны"}
                {event.studentSubjectLabel ? ` · ${event.studentSubjectLabel}` : ""}
              </p>
              {event.studentId && studentSubjects.length ? (
                <label className="cb-sch-field">
                  <span>Предмет занятия</span>
                  <select
                    value={studentSubjectId}
                    onChange={(e) => setStudentSubjectId(e.target.value)}
                    disabled={saving}
                  >
                    <option value="">Не указан</option>
                    {studentSubjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.display_label || s.subject_label || s.subject}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </section>

            <PlanSyncSection event={event} disabled={saving} />

            <section className="cb-sch-form__section">
              <h3>Время</h3>
              <div className="cb-sch-form__row">
                <label className="cb-sch-field">
                  <span>Дата</span>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required disabled={saving} />
                </label>
                <label className="cb-sch-field">
                  <span>Начало</span>
                  <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={saving} />
                </label>
                <label className="cb-sch-field">
                  <span>Окончание</span>
                  <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} disabled={saving} />
                </label>
              </div>
            </section>

            <section className="cb-sch-form__section">
              <h3>Онлайн-встреча</h3>
              <label className="cb-sch-field">
                <span>Ссылка</span>
                <input
                  type="text"
                  inputMode="url"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  placeholder="https://…"
                  disabled={saving}
                />
              </label>
            </section>

            <section className="cb-sch-form__section">
              <h3>Уведомления</h3>
              <label className="cb-sch-check">
                <input
                  type="checkbox"
                  checked={notifyParticipants}
                  onChange={(e) => setNotifyParticipants(e.target.checked)}
                  disabled={saving}
                />
                <span>Уведомить участников</span>
              </label>
            </section>

            <div className="cb-sch-modal__actions">
              <button type="submit" className="cb-btn cb-btn--primary" disabled={saving}>
                {saving ? "Сохранение…" : "Сохранить"}
              </button>
              <button type="button" className="cb-btn cb-btn--outline" onClick={onClose} disabled={saving}>
                Отмена
              </button>
            </div>
          </form>
        </div>
      </div>
      ) : null}

      {scopeOpen ? (
        <SeriesScopeModal
          onClose={() => {
            if (!savingRef.current) setScopeOpen(false);
          }}
          onConfirm={submitWithScope}
          saving={saving}
          timeChanged={scopeTimeChanged}
        />
      ) : null}
    </>
  );
}
