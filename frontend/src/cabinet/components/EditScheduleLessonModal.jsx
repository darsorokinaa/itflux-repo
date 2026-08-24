import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import CabinetIcon from "../CabinetIcons";
import SeriesScopeModal from "./SeriesScopeModal";
import PlanEditorResourceBlock from "./PlanEditorResourceBlock";
import PlanItemResourcesPicker from "./PlanItemResourcesPicker";
import {
  ensureScheduleEventPlanItem,
  fetchLessonPlan,
  fetchPlanEnrollments,
  fetchStudentSubjects,
  linkScheduleEventPlanItem,
  setScheduleEventPlanSync,
  syncScheduleEventFromPlan,
  syncScheduleEventToPlan,
  updateLessonPlanItem,
  updateScheduleEventContent,
} from "../../utils/cabinetAuth";
import { homeworkResourceRows, planItemForScheduleEvent } from "../planItemAttachments";
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

function homeworkStateFromEvent(event) {
  const planItem = event?.planItem || null;
  return {
    planItemId: planItem?.id || event?.lessonPlanItemId || null,
    homeworkMaterials: planItem?.homeworkMaterials || [],
    homeworkInteractives: planItem?.homeworkInteractives || [],
    homeworkDescription: event?.homeworkDescription || planItem?.homeworkDescription || "",
  };
}

/** Тема/описание/цель/ДЗ занятия + связь с планом обучения ученика. */
const PlanSyncSection = forwardRef(function PlanSyncSection({ event, disabled, onEventUpdated }, ref) {
  const initialHw = homeworkStateFromEvent(event);
  const [topic, setTopic] = useState(event.topic || "");
  const [subtopic, setSubtopic] = useState(event.subtopic || "");
  const [description, setDescription] = useState(event.description || "");
  const [goal, setGoal] = useState(event.goal || "");
  const [homeworkDescription, setHomeworkDescription] = useState(initialHw.homeworkDescription);
  const [homeworkMaterials, setHomeworkMaterials] = useState(initialHw.homeworkMaterials);
  const [homeworkInteractives, setHomeworkInteractives] = useState(initialHw.homeworkInteractives);
  const [planItemId, setPlanItemId] = useState(initialHw.planItemId);
  const [hwPickerOpen, setHwPickerOpen] = useState(false);
  const [hwBusy, setHwBusy] = useState(false);
  // Мета синхронизации ведём локально: ответы sync-эндпоинтов приходят сразу,
  // а полноценный рефреш списка занятий на странице расписания — только после
  // закрытия модалки, поэтому статус/ссылку на план обновляем сами.
  const [syncMeta, setSyncMeta] = useState({
    linkedPlanId: event.linkedPlanId || null,
    linkedPlanTitle: event.linkedPlanTitle || "",
    contentSource: event.contentSource || "manual",
    planSyncEnabled: event.planSyncEnabled !== false,
    planSyncedAt: event.planSyncedAt || null,
    isAutoMaterialsPlan: Boolean(event.isAutoMaterialsPlan),
  });
  const [conflict, setConflict] = useState(null);
  const [savingContent, setSavingContent] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);
  const [planNotice, setPlanNotice] = useState("");
  const [pickerItems, setPickerItems] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState("");
  const savingRef = useRef(false);

  const hasRealPlanLink = Boolean(syncMeta.linkedPlanId) && !syncMeta.isAutoMaterialsPlan;

  useEffect(() => {
    const hw = homeworkStateFromEvent(event);
    setTopic(event.topic || "");
    setSubtopic(event.subtopic || "");
    setDescription(event.description || "");
    setGoal(event.goal || "");
    setHomeworkDescription(hw.homeworkDescription);
    setHomeworkMaterials(hw.homeworkMaterials);
    setHomeworkInteractives(hw.homeworkInteractives);
    setPlanItemId(hw.planItemId);
    setSyncMeta({
      linkedPlanId: event.linkedPlanId || null,
      linkedPlanTitle: event.linkedPlanTitle || "",
      contentSource: event.contentSource || "manual",
      planSyncEnabled: event.planSyncEnabled !== false,
      planSyncedAt: event.planSyncedAt || null,
      isAutoMaterialsPlan: Boolean(event.isAutoMaterialsPlan),
    });
    setConflict(null);
  }, [event.id]);

  const applyPlanItem = (planItem, eventPatch = {}) => {
    if (!planItem) return;
    setPlanItemId(planItem.id || null);
    setHomeworkMaterials(planItem.homeworkMaterials || []);
    setHomeworkInteractives(planItem.homeworkInteractives || []);
    if (planItem.homeworkDescription !== undefined && eventPatch.homeworkDescription === undefined) {
      setHomeworkDescription(planItem.homeworkDescription || "");
    }
    onEventUpdated?.({
      id: event.id,
      ...eventPatch,
      planItem: { ...(event.planItem || {}), ...planItem },
      lessonPlanItemId: planItem.id,
    });
  };

  const applyServerEvent = (patch) => {
    if (!patch) return;
    if (patch.topic !== undefined) setTopic(patch.topic || "");
    if (patch.subtopic !== undefined) setSubtopic(patch.subtopic || "");
    if (patch.description !== undefined) setDescription(patch.description || "");
    if (patch.goal !== undefined) setGoal(patch.goal || "");
    if (patch.homeworkDescription !== undefined) setHomeworkDescription(patch.homeworkDescription || "");
    if (patch.planItem) {
      setPlanItemId(patch.planItem.id || null);
      setHomeworkMaterials(patch.planItem.homeworkMaterials || []);
      setHomeworkInteractives(patch.planItem.homeworkInteractives || []);
    }
    setSyncMeta((prev) => ({
      linkedPlanId: patch.linkedPlanId !== undefined ? patch.linkedPlanId : prev.linkedPlanId,
      linkedPlanTitle: patch.linkedPlanTitle !== undefined ? patch.linkedPlanTitle : prev.linkedPlanTitle,
      contentSource: patch.contentSource !== undefined ? patch.contentSource : prev.contentSource,
      planSyncEnabled: patch.planSyncEnabled !== undefined ? patch.planSyncEnabled : prev.planSyncEnabled,
      planSyncedAt: patch.planSyncedAt !== undefined ? patch.planSyncedAt : prev.planSyncedAt,
      isAutoMaterialsPlan: patch.isAutoMaterialsPlan !== undefined
        ? Boolean(patch.isAutoMaterialsPlan)
        : prev.isAutoMaterialsPlan,
    }));
    onEventUpdated?.(patch);
  };

  const isGroup = Boolean(event.groupId || event.type === "group" || event.type === "group_lesson");

  useEffect(() => {
    if (hasRealPlanLink || !event.studentId || isGroup) {
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
  }, [event.studentId, hasRealPlanLink, isGroup]);

  const changedContent = () => {
    const patch = {};
    if (topic !== (event.topic || "")) patch.topic = topic;
    if (subtopic !== (event.subtopic || "")) patch.subtopic = subtopic;
    if (description !== (event.description || "")) patch.description = description;
    if (goal !== (event.goal || "")) patch.goal = goal;
    const prevHw = event.homeworkDescription || event.planItem?.homeworkDescription || "";
    if (homeworkDescription !== prevHw) patch.homework_description = homeworkDescription;
    return patch;
  };

  const defaultSyncAction = () => {
    const shouldSyncToPlan = syncMeta.planSyncEnabled !== false && hasRealPlanLink;
    return shouldSyncToPlan ? "lesson_and_plan" : "lesson_only";
  };

  const submitContent = async (extra = {}) => {
    const patch = changedContent();
    if (!Object.keys(patch).length && !Object.keys(extra).length) return null;
    if (savingRef.current) return null;
    savingRef.current = true;
    setSavingContent(true);
    setSaveOk(false);
    const payload = { ...patch, ...extra };
    if (!payload.sync_action && !payload.resolve_conflict) {
      payload.sync_action = defaultSyncAction();
    }
    try {
      const data = await updateScheduleEventContent(event.id, payload);
      setConflict(null);
      const planInfo = data?.edit?.plan;
      if (planInfo && planInfo.plan_updated === false && planInfo.plan_message) {
        setPlanNotice(planInfo.plan_message);
      } else {
        setPlanNotice("");
      }
      setSaveOk(true);
      applyServerEvent(data?.scheduleEvent);
      // Черновик ДЗ на пункте плана (в т.ч. авто-черновик материалов).
      if (patch.homework_description !== undefined) {
        try {
          const ensured = await ensureScheduleEventPlanItem(event.id);
          const item = ensured?.planItem;
          if (item?.id) {
            const updated = await updateLessonPlanItem(item.id, {
              homework_description: homeworkDescription,
            });
            applyPlanItem(planItemForScheduleEvent(updated, {
              lessonNumber: item.lessonNumber,
              planTitle: item.planTitle,
            }), { homeworkDescription });
          }
        } catch {
          /* текст уже сохранён в карточке урока */
        }
      }
      return data;
    } catch (err) {
      setSaveOk(false);
      if (err?.status === 409 && err?.data?.conflict) {
        setConflict({
          message: err.data.detail || "Тема этого урока отличается от темы в плане обучения.",
          choices: err.data.choices || [],
        });
      } else {
        setPlanNotice(err?.message || "Не удалось сохранить изменения.");
      }
      throw err;
    } finally {
      savingRef.current = false;
      setSavingContent(false);
    }
  };

  useImperativeHandle(ref, () => ({
    flush: () => submitContent(),
    isDirty: () => Object.keys(changedContent()).length > 0,
  }));

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

  const ensureHwPlanItem = async () => {
    const data = await ensureScheduleEventPlanItem(event.id);
    const planItem = data?.planItem || null;
    if (!planItem?.id) throw new Error("Не удалось подготовить урок для ДЗ");
    const mapped = {
      ...planItem,
      homeworkMaterials: planItem.homeworkMaterials || [],
      homeworkInteractives: planItem.homeworkInteractives || [],
    };
    setPlanItemId(mapped.id);
    setHomeworkMaterials(mapped.homeworkMaterials);
    setHomeworkInteractives(mapped.homeworkInteractives);
    onEventUpdated?.({
      id: event.id,
      planItem: { ...(event.planItem || {}), ...mapped },
      lessonPlanItemId: mapped.id,
      linkedPlanId: event.linkedPlanId,
      isAutoMaterialsPlan: event.isAutoMaterialsPlan,
    });
    return mapped;
  };

  const openHomeworkPicker = async () => {
    setPlanNotice("");
    setHwBusy(true);
    try {
      await ensureHwPlanItem();
      setHwPickerOpen(true);
    } catch (err) {
      setPlanNotice(err?.message || "Не удалось открыть добавление ДЗ");
    } finally {
      setHwBusy(false);
    }
  };

  const handleAttachHomeworkMaterial = async (material) => {
    if (!material?.id) return;
    setHwBusy(true);
    try {
      const ensured = await ensureHwPlanItem();
      const current = (ensured.homeworkMaterials || homeworkMaterials).map((m) => m.id).filter(Boolean);
      if (!current.includes(material.id)) current.push(material.id);
      const data = await updateLessonPlanItem(ensured.id, { homework_material_ids: current });
      applyPlanItem(planItemForScheduleEvent(data, {
        lessonNumber: ensured.lessonNumber,
        planTitle: ensured.planTitle,
      }));
      setHwPickerOpen(false);
    } catch (err) {
      setPlanNotice(err?.message || "Не удалось добавить материал ДЗ");
      throw err;
    } finally {
      setHwBusy(false);
    }
  };

  const handleAttachHomeworkInteractive = async (interactive) => {
    if (!interactive?.id) return;
    setHwBusy(true);
    try {
      const ensured = await ensureHwPlanItem();
      const current = (ensured.homeworkInteractives || homeworkInteractives).map((i) => i.id).filter(Boolean);
      if (!current.includes(interactive.id)) current.push(interactive.id);
      const data = await updateLessonPlanItem(ensured.id, { homework_interactive_ids: current });
      const fromApi = planItemForScheduleEvent(data, {
        lessonNumber: ensured.lessonNumber,
        planTitle: ensured.planTitle,
      });
      applyPlanItem(fromApi);
      setHwPickerOpen(false);
    } catch (err) {
      setPlanNotice(err?.message || "Не удалось добавить интерактив в ДЗ");
      throw err;
    } finally {
      setHwBusy(false);
    }
  };

  const handleRemoveHomeworkResource = async (row) => {
    setPlanNotice("");
    setHwBusy(true);
    try {
      const ensured = planItemId
        ? { id: planItemId, homeworkMaterials, homeworkInteractives }
        : await ensureHwPlanItem();
      if (row.materialId) {
        const nextIds = (ensured.homeworkMaterials || homeworkMaterials)
          .map((m) => m.id)
          .filter((id) => Number(id) !== Number(row.materialId));
        const data = await updateLessonPlanItem(ensured.id, { homework_material_ids: nextIds });
        applyPlanItem(planItemForScheduleEvent(data, {
          lessonNumber: ensured.lessonNumber,
          planTitle: ensured.planTitle,
        }));
      } else if (row.interactiveId) {
        const nextIds = (ensured.homeworkInteractives || homeworkInteractives)
          .map((i) => i.id)
          .filter((id) => Number(id) !== Number(row.interactiveId));
        const data = await updateLessonPlanItem(ensured.id, { homework_interactive_ids: nextIds });
        applyPlanItem(planItemForScheduleEvent(data, {
          lessonNumber: ensured.lessonNumber,
          planTitle: ensured.planTitle,
        }));
      }
    } catch (err) {
      setPlanNotice(err?.message || "Не удалось убрать материал ДЗ");
    } finally {
      setHwBusy(false);
    }
  };

  const hwRows = homeworkResourceRows({
    homeworkMaterials,
    homeworkInteractives,
  });

  return (
    <section className="cb-sch-form__section cb-sch-form__section--plan-sync">
      <h3>Тема и план обучения</h3>

      {hasRealPlanLink ? (
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
      {saveOk && !planNotice ? (
        <p className="cb-sch-form__hint" role="status">
          {hasRealPlanLink ? "Сохранено. Карточка и план обучения обновлены." : "Сохранено."}
        </p>
      ) : null}

      <label className="cb-sch-field">
        <span>Тема урока</span>
        {event?.plannedTopic && event.plannedTopic !== topic ? (
          <span className="cb-sch-form__hint">По плану: {event.plannedTopic}</span>
        ) : null}
        <input
          type="text"
          value={topic}
          onChange={(e) => { setTopic(e.target.value); setSaveOk(false); }}
          disabled={disabled}
        />
      </label>
      <label className="cb-sch-field">
        <span>Подтема</span>
        <input
          type="text"
          value={subtopic}
          onChange={(e) => { setSubtopic(e.target.value); setSaveOk(false); }}
          disabled={disabled}
        />
      </label>
      <label className="cb-sch-field">
        <span>Цель урока</span>
        <textarea
          rows={2}
          value={goal}
          onChange={(e) => { setGoal(e.target.value); setSaveOk(false); }}
          disabled={disabled}
        />
      </label>
      <label className="cb-sch-field">
        <span>О занятии</span>
        <textarea
          rows={2}
          value={description}
          onChange={(e) => { setDescription(e.target.value); setSaveOk(false); }}
          disabled={disabled}
          placeholder="Что планируется или что было пройдено на уроке"
        />
      </label>

      <div className="cb-sch-field cb-sch-field--hw-draft">
        <PlanEditorResourceBlock
          label="Домашнее задание (черновик)"
          emptyLabel="ДЗ не задано"
          actionLabel="Настроить"
          rows={hwRows}
          notes={homeworkDescription}
          notesPlaceholder="Описание ДЗ"
          alwaysShowNotes
          onNotesChange={(e) => { setHomeworkDescription(e.target.value); setSaveOk(false); }}
          onAttach={disabled || hwBusy ? undefined : openHomeworkPicker}
          onRemove={disabled || hwBusy ? undefined : handleRemoveHomeworkResource}
        />
        {hwBusy ? <p className="cb-sch-form__hint">Сохранение ДЗ…</p> : null}
      </div>

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
            onClick={() => submitContent().catch(() => {})}
          >
            {savingContent ? "Сохранение…" : "Сохранить тему/описание"}
          </button>
          <button
            type="button"
            className="cb-btn cb-btn--outline"
            disabled={disabled || savingContent}
            onClick={() => {
              const hw = homeworkStateFromEvent(event);
              setTopic(event.topic || "");
              setSubtopic(event.subtopic || "");
              setDescription(event.description || "");
              setGoal(event.goal || "");
              setHomeworkDescription(hw.homeworkDescription);
              setHomeworkMaterials(hw.homeworkMaterials);
              setHomeworkInteractives(hw.homeworkInteractives);
              setConflict(null);
              setPlanNotice("");
              setSaveOk(false);
            }}
          >
            Отмена
          </button>
        </div>
      )}

      {hwPickerOpen ? (
        <PlanItemResourcesPicker
          scope="homework"
          open
          initialTab="library"
          attachedMaterialIds={homeworkMaterials.map((m) => m.id).filter(Boolean)}
          attachedInteractiveIds={homeworkInteractives.map((i) => i.id).filter(Boolean)}
          onClose={() => setHwPickerOpen(false)}
          onAttachMaterial={handleAttachHomeworkMaterial}
          onAttachInteractive={handleAttachHomeworkInteractive}
        />
      ) : null}
    </section>
  );
});

export default function EditScheduleLessonModal({ event, onClose, onSave, onEventUpdated }) {
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
  const contentRef = useRef(null);

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

  const flushContentIfNeeded = async () => {
    if (!contentRef.current?.isDirty?.()) return;
    try {
      await contentRef.current.flush();
    } catch {
      throw new Error("Не удалось сохранить тему или описание занятия.");
    }
  };

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
      // Сначала сохраняем тему/ДЗ, чтобы они не потерялись при выборе scope серии.
      savingRef.current = true;
      setSaving(true);
      setError("");
      try {
        await flushContentIfNeeded();
        setScopeTimeChanged(!eventTimesUnchanged());
        setScopeOpen(true);
      } catch (err) {
        setError(err.message || "Не удалось сохранить изменения.");
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      await flushContentIfNeeded();
      await onSave(buildPayload());
      onClose();
    } catch (err) {
      setError(err.message || "Не удалось сохранить изменения.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  if (typeof document === "undefined") return null;

  return (
    <>
      {!scopeOpen ? createPortal(
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

            <PlanSyncSection
              ref={contentRef}
              event={event}
              disabled={saving}
              onEventUpdated={onEventUpdated}
            />

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
      </div>,
      document.body
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
