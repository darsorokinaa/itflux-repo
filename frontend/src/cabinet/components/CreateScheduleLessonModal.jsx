import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import CabinetIcon from "../CabinetIcons";
import {
  billingPlanCheck,
  fetchGroups,
  fetchNextPlanItem,
  fetchStudentSubjects,
  fetchStudents,
} from "../../utils/cabinetAuth";
import { formatMoney, formatUnits } from "../billing/billingFormat";
import { useAccessGate } from "../../hooks/useAccessGate";
import "../styles/payments.css";

const WEEKDAYS = [
  { value: 0, label: "Пн" },
  { value: 1, label: "Вт" },
  { value: 2, label: "Ср" },
  { value: 3, label: "Чт" },
  { value: 4, label: "Пт" },
  { value: 5, label: "Сб" },
  { value: 6, label: "Вс" },
];

const RECURRENCE_OPTIONS = [
  { value: "none", label: "Не повторять" },
  { value: "daily", label: "Каждый день" },
  { value: "weekly", label: "Каждую неделю" },
  { value: "weekdays", label: "По будням" },
  { value: "custom_weekdays", label: "По выбранным дням" },
  { value: "biweekly", label: "Каждые 2 недели" },
  { value: "monthly", label: "Каждый месяц" },
];

const REMINDER_OPTIONS = [
  { value: "", label: "Не напоминать" },
  { value: 5, label: "За 5 минут" },
  { value: 15, label: "За 15 минут" },
  { value: 60, label: "За 1 час" },
  { value: 1440, label: "За 1 день" },
];

function formatApiDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildLessonTitle({ audienceLabel, type }) {
  if (audienceLabel.trim()) return audienceLabel.trim();
  return type === "individual_lesson" ? "Индивидуальное занятие" : "Групповое занятие";
}

function formatConflictTime(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(iso);
  }
}

function conflictTypeLabel(type) {
  if (type === "teacher") return "У вас";
  if (type === "student") return "У ученика";
  if (type === "group") return "У группы";
  return "Конфликт";
}

export default function CreateScheduleLessonModal({
  onClose,
  onCreate,
  defaultDate,
  defaultStartTime,
  defaultEndTime,
  defaultLessonTitle,
  defaultTopic,
  defaultType,
  defaultFormat,
  defaultGroupId,
  defaultStudentId,
  defaultStudentIds,
  lessonPlanItemId,
  dialogTitle,
}) {
  const [type, setType] = useState(defaultType || "group_lesson");
  const [date, setDate] = useState(defaultDate || formatApiDate(new Date()));
  const [startTime, setStartTime] = useState(defaultStartTime || "15:00");
  const [endTime, setEndTime] = useState(defaultEndTime || "15:45");
  const [lessonTitle, setLessonTitle] = useState(defaultLessonTitle || "");
  const [topic, setTopic] = useState(defaultTopic || "");
  const [timezone, setTimezone] = useState("Europe/Moscow");
  const [format, setFormat] = useState(
    defaultFormat === "offline" || defaultFormat === "Офлайн" ? "offline" : "online",
  );
  const isIndividual = type === "individual_lesson";
  const [groupId, setGroupId] = useState(defaultGroupId ? String(defaultGroupId) : "");
  const [studentId, setStudentId] = useState(defaultStudentId ? String(defaultStudentId) : "");
  const [selectedStudentIds, setSelectedStudentIds] = useState(
    Array.isArray(defaultStudentIds) ? defaultStudentIds.map(Number) : [],
  );
  const [recurrenceType, setRecurrenceType] = useState("none");
  const [weekdays, setWeekdays] = useState([]);
  const [repeatUntil, setRepeatUntil] = useState("");
  const [repeatCount, setRepeatCount] = useState("");
  const [repeatEndMode, setRepeatEndMode] = useState("none");
  const [reminderMinutes, setReminderMinutes] = useState(15);
  const [notifyParticipants, setNotifyParticipants] = useState(true);
  const [meetingMode, setMeetingMode] = useState("auto");
  const [manualLink, setManualLink] = useState("");
  const [saving, setSaving] = useState(false);
  const { modal: accessGateModal, openFromError } = useAccessGate({
    authenticated: true,
    sourcePage: "/cabinet/schedule",
  });
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(null);
  const [students, setStudents] = useState([]);
  const [groups, setGroups] = useState([]);
  const [billingPreview, setBillingPreview] = useState(null);
  const [studentSubjects, setStudentSubjects] = useState([]);
  const [studentSubjectId, setStudentSubjectId] = useState("");
  const [subjectsLoading, setSubjectsLoading] = useState(false);
  const [nextPlanItem, setNextPlanItem] = useState(null);
  const [planProgress, setPlanProgress] = useState(null);
  const [planLinkMode, setPlanLinkMode] = useState(lessonPlanItemId ? "use" : "suggest");
  const [selectedPlanItemId, setSelectedPlanItemId] = useState(lessonPlanItemId || null);

  useEffect(() => {
    if (defaultDate) setDate(defaultDate);
    if (defaultStartTime) setStartTime(defaultStartTime);
    if (defaultEndTime) setEndTime(defaultEndTime);
  }, [defaultDate, defaultStartTime, defaultEndTime]);

  useEffect(() => {
    if (defaultLessonTitle) setLessonTitle(defaultLessonTitle);
    if (defaultTopic != null) setTopic(defaultTopic);
  }, [defaultLessonTitle, defaultTopic]);

  useEffect(() => {
    if (defaultType) setType(defaultType);
  }, [defaultType]);

  useEffect(() => {
    if (!defaultFormat) return;
    setFormat(defaultFormat === "offline" || defaultFormat === "Офлайн" ? "offline" : "online");
  }, [defaultFormat]);

  useEffect(() => {
    if (defaultGroupId != null && defaultGroupId !== "") {
      setGroupId(String(defaultGroupId));
    }
  }, [defaultGroupId]);

  useEffect(() => {
    if (defaultStudentId != null && defaultStudentId !== "") {
      setStudentId(String(defaultStudentId));
    }
  }, [defaultStudentId]);

  useEffect(() => {
    if (Array.isArray(defaultStudentIds) && defaultStudentIds.length) {
      setSelectedStudentIds(defaultStudentIds.map(Number));
    }
  }, [defaultStudentIds]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchStudents({ status: "active" }),
      fetchGroups({ status: "active" }),
    ])
      .then(([s, g]) => {
        if (cancelled) return;
        setStudents(s?.results || s || []);
        setGroups(g?.results || g || []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!studentId) {
      setBillingPreview(null);
      return undefined;
    }
    const [sh, sm] = String(startTime || "0:0").split(":").map(Number);
    const [eh, em] = String(endTime || "0:0").split(":").map(Number);
    let minutes = (eh * 60 + em) - (sh * 60 + sm);
    if (!Number.isFinite(minutes) || minutes <= 0) minutes = 60;
    let cancelled = false;
    billingPlanCheck({ student_id: Number(studentId), duration_minutes: minutes })
      .then((data) => {
        if (!cancelled) setBillingPreview(data);
      })
      .catch(() => {
        if (!cancelled) setBillingPreview(null);
      });
    return () => { cancelled = true; };
  }, [studentId, startTime, endTime]);

  useEffect(() => {
    if (!isIndividual || !studentId) {
      setStudentSubjects([]);
      setStudentSubjectId("");
      return undefined;
    }
    let cancelled = false;
    setSubjectsLoading(true);
    fetchStudentSubjects(studentId)
      .then((data) => {
        if (cancelled) return;
        const list = (Array.isArray(data) ? data : data?.items || [])
          .filter((s) => s.status !== "archived");
        setStudentSubjects(list);
        if (list.length === 1) {
          setStudentSubjectId(String(list[0].id));
        } else {
          setStudentSubjectId((prev) => (
            list.some((s) => String(s.id) === String(prev)) ? prev : ""
          ));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStudentSubjects([]);
          setStudentSubjectId("");
        }
      })
      .finally(() => {
        if (!cancelled) setSubjectsLoading(false);
      });
    return () => { cancelled = true; };
  }, [isIndividual, studentId]);

  useEffect(() => {
    if (lessonPlanItemId) {
      setSelectedPlanItemId(lessonPlanItemId);
      setPlanLinkMode("use");
      return undefined;
    }
    const sid = studentId || (selectedStudentIds.length === 1 ? selectedStudentIds[0] : "");
    if (!sid && !groupId) {
      setNextPlanItem(null);
      setPlanProgress(null);
      return undefined;
    }
    let cancelled = false;
    fetchNextPlanItem({
      studentId: sid || undefined,
      groupId: groupId || undefined,
      studentSubjectId: studentSubjectId || undefined,
    })
      .then((data) => {
        if (cancelled) return;
        setNextPlanItem(data?.item || null);
        setPlanProgress(data?.progress || null);
      })
      .catch(() => {
        if (!cancelled) {
          setNextPlanItem(null);
          setPlanProgress(null);
        }
      });
    return () => { cancelled = true; };
  }, [studentId, selectedStudentIds, groupId, studentSubjectId, lessonPlanItemId]);

  const audienceLabel = useMemo(() => {
    if (groupId) {
      const g = groups.find((x) => String(x.id) === String(groupId));
      return g?.title || "";
    }
    if (studentId) {
      const s = students.find((x) => String(x.id) === String(studentId));
      return s?.full_name || "";
    }
    if (selectedStudentIds.length) {
      return selectedStudentIds
        .map((id) => students.find((x) => x.id === id)?.full_name)
        .filter(Boolean)
        .join(", ");
    }
    return "";
  }, [groupId, studentId, selectedStudentIds, groups, students]);

  const toggleStudent = (id) => {
    setSelectedStudentIds((prev) => (
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    ));
    setStudentId("");
  };

  const toggleExtraStudent = (id) => {
    setSelectedStudentIds((prev) => (
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    ));
  };

  const toggleWeekday = (value) => {
    setWeekdays((prev) => (
      prev.includes(value) ? prev.filter((d) => d !== value) : [...prev, value].sort()
    ));
  };

  const participantStudentIds = () => {
    if (groupId) {
      return selectedStudentIds.length ? selectedStudentIds : undefined;
    }
    if (studentId) return [Number(studentId)];
    if (selectedStudentIds.length) return selectedStudentIds;
    return undefined;
  };

  const buildPayload = (force = false) => {
    const ids = participantStudentIds();
    const payload = {
      title: lessonTitle.trim() || buildLessonTitle({ audienceLabel, type }),
      topic: topic.trim() || undefined,
      type,
      event_type: type,
      audience: audienceLabel,
      format,
      starts_at: `${date}T${startTime}:00`,
      ends_at: `${date}T${endTime}:00`,
      timezone,
      group_id: groupId ? Number(groupId) : undefined,
      student_ids: ids,
      extra_student_ids: groupId && selectedStudentIds.length ? selectedStudentIds : undefined,
      recurrence_type: recurrenceType,
      recurrence_weekdays: recurrenceType === "custom_weekdays" ? weekdays : undefined,
      recurrence_until: repeatEndMode === "date" && repeatUntil ? repeatUntil : undefined,
      recurrence_count: repeatEndMode === "count" && repeatCount ? Number(repeatCount) : undefined,
      reminder_minutes: reminderMinutes || undefined,
      notify_participants: notifyParticipants,
      lesson_plan_item: planLinkMode === "skip" ? undefined : (selectedPlanItemId || lessonPlanItemId || undefined),
      lesson_plan_item_id: planLinkMode === "skip" ? undefined : (selectedPlanItemId || lessonPlanItemId || undefined),
      skip_plan: planLinkMode === "skip" || undefined,
      student_subject: studentSubjectId ? Number(studentSubjectId) : undefined,
      student_subject_id: studentSubjectId ? Number(studentSubjectId) : undefined,
      force,
    };
    if (meetingMode === "manual" && manualLink.trim()) {
      payload.telemost_url = manualLink.trim();
      payload.link = manualLink.trim();
      payload.jitsi_auto_create = false;
    } else if (meetingMode === "auto") {
      payload.telemost_url = "";
      payload.jitsi_auto_create = true;
    } else {
      payload.telemost_url = "";
      payload.jitsi_auto_create = false;
    }
    return payload;
  };

  const handleSubmit = async (e, force = false) => {
    e.preventDefault();
    setError("");
    setConflict(null);
    if (!groupId && !studentId && !selectedStudentIds.length) {
      setError(isIndividual ? "Выберите ученика." : "Выберите группу или ученика.");
      return;
    }
    if (isIndividual && studentId && studentSubjects.length === 0 && !subjectsLoading) {
      setError("У ученика нет предметов. Добавьте предмет в карточке ученика, чтобы создать занятие.");
      return;
    }
    if (isIndividual && studentSubjects.length > 1 && !studentSubjectId) {
      setError("Выберите предмет занятия.");
      return;
    }
    if (billingPreview?.block && !force) {
      setError(billingPreview.warning || "Недостаточно абонемента для этого занятия.");
      return;
    }
    setSaving(true);
    try {
      await onCreate(buildPayload(force));
    } catch (err) {
      if (openFromError(err)) {
        setError("");
      } else if (err.code === "schedule_conflict" || err.message?.includes("уже есть занятие")) {
        setConflict(err.conflicts || true);
        setError("В это время уже есть занятие.");
      } else {
        setError(err.message || "Не удалось сохранить урок.");
      }
    } finally {
      setSaving(false);
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
    <div className="cb-sch-overlay" onClick={onClose} role="presentation">
      <div
        className="cb-sch-modal cb-sch-modal--wide"
        onClick={(ev) => ev.stopPropagation()}
        role="dialog"
        aria-labelledby="sch-create-title"
      >
        <div className="cb-sch-modal__head">
          <h2 id="sch-create-title">{dialogTitle || "Новый урок"}</h2>
          <button type="button" className="cb-sch-popover__close" onClick={onClose} aria-label="Закрыть">
            <CabinetIcon name="close" />
          </button>
        </div>
        <form className="cb-sch-form cb-sch-form--sections" onSubmit={(e) => handleSubmit(e, false)}>
          {error ? <p className="cb-sch-form__error" role="alert">{error}</p> : null}
          {!lessonPlanItemId && !nextPlanItem && (planProgress?.is_finished || planProgress?.is_schedule_exhausted) ? (
            <section className="cb-sch-form__section">
              <h3>План уроков</h3>
              <p className="cb-sch-field-hint">
                {planProgress.warning_message || "План обучения завершён. Занятие будет создано без темы — добавьте темы в план."}
              </p>
            </section>
          ) : null}
          {!lessonPlanItemId && nextPlanItem ? (
            <section className="cb-sch-form__section">
              <h3>План уроков</h3>
              <p className="cb-sch-field-hint">
                Следующая тема по плану: {nextPlanItem.topic || nextPlanItem.title}
              </p>
              {planProgress?.warning_message && planProgress.warning_level !== "ok" ? (
                <p className="cb-sch-field-hint">{planProgress.warning_message}</p>
              ) : null}
              <div className="cb-sch-form__row" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className={`cb-btn cb-btn--sm ${planLinkMode === "use" ? "cb-btn--primary" : "cb-btn--outline"}`}
                  onClick={() => {
                    setPlanLinkMode("use");
                    setSelectedPlanItemId(nextPlanItem.id);
                    const nextTopic = (nextPlanItem.topic || nextPlanItem.title || "").trim();
                    if (nextTopic && !topic.trim()) setTopic(nextTopic);
                  }}
                >
                  Использовать
                </button>
                <button
                  type="button"
                  className={`cb-btn cb-btn--sm ${planLinkMode === "skip" ? "cb-btn--primary" : "cb-btn--outline"}`}
                  onClick={() => {
                    setPlanLinkMode("skip");
                    setSelectedPlanItemId(null);
                  }}
                >
                  Без привязки к плану
                </button>
              </div>
            </section>
          ) : null}
          {lessonPlanItemId ? (
            <section className="cb-sch-form__section">
              <h3>Занятие из плана</h3>
              <label className="cb-sch-field">
                <span>Название</span>
                <input
                  value={lessonTitle}
                  onChange={(e) => setLessonTitle(e.target.value)}
                  placeholder="Название занятия"
                />
              </label>
              <label className="cb-sch-field">
                <span>Тема</span>
                <input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Тема занятия"
                />
              </label>
            </section>
          ) : null}
          {conflict ? (
            <div className="cb-sch-form__conflict">
              <p><strong>Обнаружено пересечение:</strong></p>
              {Array.isArray(conflict) && conflict.length > 0 ? (
                <ul className="cb-sch-form__conflict-list">
                  {conflict.flatMap((block) => {
                    const events = Array.isArray(block?.events) ? block.events : [];
                    const prefix = conflictTypeLabel(block?.type);
                    return events.map((ev) => {
                      const audience = ev.audience || ev.group_title || ev.student_name || "";
                      const when = ev.starts_at
                        ? (ev.ends_at
                          ? `${formatConflictTime(ev.starts_at)}–${formatConflictTime(ev.ends_at)}`
                          : formatConflictTime(ev.starts_at))
                        : "";
                      return (
                        <li key={`${block.type}-${ev.id}`}>
                          {when ? `${when} — ` : ""}
                          {ev.title || "Занятие"}
                          {audience ? `, ${audience}` : ""}
                          {prefix ? ` (${prefix})` : ""}
                        </li>
                      );
                    });
                  })}
                </ul>
              ) : (
                <p>В это время уже есть занятие. Выберите другое время или создайте всё равно.</p>
              )}
              <button
                type="button"
                className="cb-btn cb-btn--outline cb-btn--sm"
                onClick={(e) => handleSubmit(e, true)}
              >
                Всё равно создать
              </button>
            </div>
          ) : null}

          <section className="cb-sch-form__section">
            <h3>Участники</h3>
            <label className="cb-sch-field">
              <span>Тип занятия</span>
              <select
                value={type}
                onChange={(e) => {
                  const next = e.target.value;
                  setType(next);
                  if (next === "individual_lesson") {
                    setGroupId("");
                    setSelectedStudentIds([]);
                  }
                }}
              >
                <option value="group_lesson">Групповое</option>
                <option value="individual_lesson">Индивидуальное</option>
              </select>
            </label>

            {/* Группа — только для групповых */}
            {!isIndividual && (
              <label className="cb-sch-field">
                <span>Группа</span>
                <select value={groupId} onChange={(e) => { setGroupId(e.target.value); setSelectedStudentIds([]); }}>
                  <option value="">Не выбрана</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.title}</option>
                  ))}
                </select>
              </label>
            )}

            {/* Ученик — всегда при индивидуальном; при групповом — только если группа не выбрана */}
            {(isIndividual || !groupId) && (
              <>
                <label className="cb-sch-field">
                  <span>Ученик</span>
                  <select value={studentId} onChange={(e) => { setStudentId(e.target.value); setSelectedStudentIds([]); }}>
                    <option value="">Не выбран</option>
                    {students.map((s) => (
                      <option key={s.id} value={s.id}>{s.full_name}</option>
                    ))}
                  </select>
                </label>
                {isIndividual && studentId ? (
                  <label className="cb-sch-field">
                    <span>Предмет занятия{studentSubjects.length > 1 ? " *" : ""}</span>
                    {subjectsLoading ? (
                      <p className="cb-sch-form__hint">Загрузка предметов…</p>
                    ) : studentSubjects.length === 0 ? (
                      <p className="cb-sch-form__hint">
                        У ученика пока нет предметов. Добавьте предмет в карточке ученика.
                      </p>
                    ) : (
                      <select
                        value={studentSubjectId}
                        onChange={(e) => setStudentSubjectId(e.target.value)}
                        required={studentSubjects.length > 1}
                      >
                        {studentSubjects.length > 1 ? (
                          <option value="">Выберите предмет</option>
                        ) : null}
                        {studentSubjects.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.display_label || s.subject_label || s.subject}
                          </option>
                        ))}
                      </select>
                    )}
                  </label>
                ) : null}
                {!isIndividual && (
                  <div className="cb-sch-field">
                    <span>Или несколько учеников</span>
                    <div className="cb-sch-chip-list">
                      {students.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className={`cb-sch-chip ${selectedStudentIds.includes(s.id) ? "cb-sch-chip--active" : ""}`}
                          onClick={() => toggleStudent(s.id)}
                        >
                          {s.full_name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Дополнительные ученики для групп */}
            {!isIndividual && groupId && (
              <div className="cb-sch-field">
                <span>Дополнительные ученики</span>
                <div className="cb-sch-chip-list">
                  {students.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`cb-sch-chip ${selectedStudentIds.includes(s.id) ? "cb-sch-chip--active" : ""}`}
                      onClick={() => toggleExtraStudent(s.id)}
                    >
                      {s.full_name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <p className="cb-sch-form__hint">Организатор добавляется автоматически.</p>
          </section>

          <section className="cb-sch-form__section">
            <h3>Время</h3>
            <div className="cb-sch-form__row">
              <label className="cb-sch-field">
                <span>Дата</span>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </label>
              <label className="cb-sch-field">
                <span>Начало</span>
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              </label>
              <label className="cb-sch-field">
                <span>Окончание</span>
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </label>
            </div>
            <label className="cb-sch-field">
              <span>Часовой пояс</span>
              <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                <option value="Europe/Moscow">Москва (UTC+3)</option>
                <option value="Europe/Kaliningrad">Калининград</option>
                <option value="Asia/Yekaterinburg">Екатеринбург</option>
              </select>
            </label>
          </section>

          <section className="cb-sch-form__section">
            <h3>Формат</h3>
            <label className="cb-sch-field">
              <span>Формат занятия</span>
              <select value={format} onChange={(e) => setFormat(e.target.value)}>
                <option value="online">Онлайн</option>
                <option value="offline">Офлайн</option>
              </select>
            </label>
            {format === "online" ? (
              <>
                <label className="cb-sch-field">
                  <span>Ссылка на встречу</span>
                  <select value={meetingMode} onChange={(e) => setMeetingMode(e.target.value)}>
                    <option value="auto">Создать автоматически (Jitsi)</option>
                    <option value="later">Создать позже</option>
                    <option value="manual">Ввести вручную</option>
                  </select>
                </label>
                {meetingMode === "auto" ? (
                  <p className="cb-sch-form__hint">
                    При сохранении урока сразу создастся видеокомната — ссылка появится в карточке занятия.
                  </p>
                ) : null}
                {meetingMode === "manual" ? (
                  <label className="cb-sch-field">
                    <span>URL встречи</span>
                    <input type="url" value={manualLink} onChange={(e) => setManualLink(e.target.value)} />
                  </label>
                ) : null}
              </>
            ) : null}
          </section>

          <section className="cb-sch-form__section">
            <h3>Повторение</h3>
            <label className="cb-sch-field">
              <span>Периодичность</span>
              <select value={recurrenceType} onChange={(e) => setRecurrenceType(e.target.value)}>
                {RECURRENCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            {recurrenceType === "custom_weekdays" ? (
              <div className="cb-sch-weekdays">
                {WEEKDAYS.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    className={`cb-sch-weekday ${weekdays.includes(d.value) ? "cb-sch-weekday--active" : ""}`}
                    onClick={() => toggleWeekday(d.value)}
                    aria-pressed={weekdays.includes(d.value)}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            ) : null}
            {recurrenceType !== "none" ? (
              <>
                <label className="cb-sch-field">
                  <span>Повторять до</span>
                  <select value={repeatEndMode} onChange={(e) => setRepeatEndMode(e.target.value)}>
                    <option value="none">Без даты окончания</option>
                    <option value="date">До выбранной даты</option>
                    <option value="count">Количество занятий</option>
                  </select>
                </label>
                {repeatEndMode === "date" ? (
                  <label className="cb-sch-field">
                    <span>Дата окончания</span>
                    <input type="date" value={repeatUntil} onChange={(e) => setRepeatUntil(e.target.value)} />
                  </label>
                ) : null}
                {repeatEndMode === "count" ? (
                  <label className="cb-sch-field">
                    <span>Количество занятий</span>
                    <input type="number" min="1" value={repeatCount} onChange={(e) => setRepeatCount(e.target.value)} />
                  </label>
                ) : null}
              </>
            ) : null}
          </section>

          {billingPreview ? (
            <section className="cb-sch-form__section">
              <h3>Стоимость занятия</h3>
              <p className="pay-hint">
                {billingPreview.price_preview?.price_source_label
                  || formatMoney(billingPreview.price_preview?.amount, billingPreview.price_preview?.currency)}
              </p>
              {billingPreview.package ? (
                <p className="pay-hint">
                  Абонемент: осталось {formatUnits(billingPreview.package.remaining_units, billingPreview.package.unit_type)}
                </p>
              ) : null}
              {billingPreview.warning ? (
                <p className="pay-hint pay-hint--warn">{billingPreview.warning}</p>
              ) : null}
            </section>
          ) : null}

          <div className="cb-sch-modal__actions">
            <button type="submit" className="cb-btn cb-btn--primary" disabled={saving}>
              {saving ? "Сохранение…" : recurrenceType !== "none" ? "Создать серию" : "Создать урок"}
            </button>
            <button type="button" className="cb-btn cb-btn--outline" onClick={onClose}>Отмена</button>
          </div>
        </form>
      </div>
    </div>
    {accessGateModal}
    </>,
    document.body
  );
}
