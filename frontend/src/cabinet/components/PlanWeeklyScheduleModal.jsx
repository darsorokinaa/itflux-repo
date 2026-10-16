import { useEffect, useMemo, useState } from "react";
import CabinetModal from "./CabinetModal";
import { fetchPlanWeeklySchedule, submitPlanWeeklySchedule } from "../../utils/cabinetAuth";
import "../styles/plan-weekly-schedule.css";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const DURATIONS = [30, 45, 60, 90, 120];

const ACTION_LABELS = {
  create: "Новое",
  move: "Перенос",
  unchanged: "Без изменений",
  keep: "В календаре",
  done: "Пройдено",
  skipped_topic: "Пропущено",
  no_slot: "Нет даты",
};

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatWhen(iso) {
  if (!iso) return "—";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return iso;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const wd = WEEKDAYS[(date.getDay() + 6) % 7];
  return `${wd}, ${m[3]}.${m[2]} · ${m[4]}:${m[5]}`;
}

function defaultState(saved) {
  const p = saved || {};
  const times = {};
  (p.slots || []).forEach((s) => { if (times[s.weekday] == null) times[s.weekday] = s.time; });
  return {
    times,
    duration: p.duration_minutes || 60,
    startDate: p.start_date && p.start_date >= todayIso() ? p.start_date : todayIso(),
    endDate: p.end_date || "",
    skipDates: p.skip_dates || [],
    format: p.format || "online",
    video: p.video || "jitsi",
    notify: Boolean(p.notify),
    conflictMode: p.conflict_mode || "skip",
    enrollmentId: p.enrollment_id || "",
  };
}

export default function PlanWeeklyScheduleModal({ planId, onClose, onApplied }) {
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState(null);
  const [form, setForm] = useState(defaultState(null));
  const [skipInput, setSkipInput] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewKey, setPreviewKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchPlanWeeklySchedule(planId)
      .then((data) => {
        if (cancelled) return;
        setMeta(data);
        const next = defaultState(data?.pattern);
        if (!next.enrollmentId && data?.enrollments?.length === 1) next.enrollmentId = data.enrollments[0].id;
        setForm(next);
      })
      .catch((err) => !cancelled && setError(err.message || "Не удалось загрузить настройки"))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [planId]);

  const pattern = useMemo(() => ({
    slots: Object.entries(form.times)
      .filter(([, time]) => time)
      .map(([weekday, time]) => ({ weekday: Number(weekday), time })),
    duration_minutes: Number(form.duration) || 60,
    start_date: form.startDate,
    end_date: form.endDate || null,
    skip_dates: form.skipDates,
    format: form.format,
    video: form.format === "online" ? form.video : "none",
    notify: form.notify,
    conflict_mode: form.conflictMode,
    enrollment_id: form.enrollmentId || null,
  }), [form]);
  const key = JSON.stringify(pattern);
  const previewFresh = preview && previewKey === key;

  const update = (patch) => { setForm((prev) => ({ ...prev, ...patch })); setDone(null); };
  const toggleDay = (wd) => {
    const times = { ...form.times };
    if (times[wd] != null) delete times[wd];
    else times[wd] = Object.values(times)[0] || "18:00";
    update({ times });
  };
  const addSkip = () => {
    if (!skipInput || form.skipDates.includes(skipInput)) return;
    update({ skipDates: [...form.skipDates, skipInput].sort() });
    setSkipInput("");
  };

  const run = async (mode) => {
    setBusy(true);
    setError("");
    try {
      const data = await submitPlanWeeklySchedule(planId, { mode, pattern });
      setPreview(data);
      setPreviewKey(key);
      if (mode === "apply") {
        const applied = data?.applied || [];
        setDone({
          created: applied.filter((a) => a.op === "create").length,
          moved: applied.filter((a) => a.op === "move").length,
          deleted: applied.filter((a) => a.op === "delete").length,
        });
        onApplied?.();
      }
    } catch (err) {
      setError(err.message || "Не удалось построить расписание");
    } finally {
      setBusy(false);
    }
  };

  const enrollments = meta?.enrollments || [];
  const summary = preview?.summary;
  const changes = summary ? summary.create + summary.move + summary.remove : 0;

  return (
    <CabinetModal
      wide
      title="Расписание занятий по плану"
      onClose={busy ? undefined : onClose}
      footer={(
        <>
          <button type="button" className="cb-btn cb-btn--secondary" onClick={onClose} disabled={busy}>
            Закрыть
          </button>
          <button
            type="button"
            className="cb-btn cb-btn--outline"
            onClick={() => run("preview")}
            disabled={busy || loading || !pattern.slots.length}
          >
            {busy ? "…" : "Предпросмотр"}
          </button>
          <button
            type="button"
            className="cb-btn cb-btn--primary"
            onClick={() => run("apply")}
            disabled={busy || !previewFresh || !changes}
            title={!previewFresh ? "Сначала нажмите «Предпросмотр»" : ""}
          >
            {busy ? "Применяем…" : "Применить"}
          </button>
        </>
      )}
    >
      {loading ? <p>Загрузка…</p> : (
        <div className="cb-pws">
          {enrollments.length === 0 ? (
            <p className="cb-inline-error">План ещё не назначен ученику или группе — назначьте план, чтобы создать занятия.</p>
          ) : enrollments.length > 1 ? (
            <label className="cb-pws__field">
              <span>Для кого</span>
              <select value={form.enrollmentId} onChange={(e) => update({ enrollmentId: Number(e.target.value) || "" })}>
                <option value="">Выберите ученика</option>
                {enrollments.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
              </select>
            </label>
          ) : (
            <p className="cb-pws__who">Ученик: <strong>{enrollments[0].label}</strong></p>
          )}

          <div className="cb-pws__field">
            <span>Дни недели и время</span>
            <div className="cb-pws__chips" role="group" aria-label="Дни недели">
              {WEEKDAYS.map((label, wd) => (
                <button
                  key={label}
                  type="button"
                  className={`cb-pws__chip${form.times[wd] != null ? " is-active" : ""}`}
                  aria-pressed={form.times[wd] != null}
                  onClick={() => toggleDay(wd)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="cb-pws__times">
              {Object.keys(form.times).sort().map((wd) => (
                <label key={wd} className="cb-pws__time">
                  <span>{WEEKDAYS[wd]}</span>
                  <input
                    type="time"
                    step="300"
                    value={form.times[wd]}
                    onChange={(e) => update({ times: { ...form.times, [wd]: e.target.value } })}
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="cb-pws__row">
            <label className="cb-pws__field">
              <span>Длительность</span>
              <select value={form.duration} onChange={(e) => update({ duration: Number(e.target.value) })}>
                {[...new Set([...DURATIONS, Number(form.duration)])].sort((a, b) => a - b).map((d) => (
                  <option key={d} value={d}>{d} мин</option>
                ))}
              </select>
            </label>
            <label className="cb-pws__field">
              <span>Начало</span>
              <input type="date" value={form.startDate} onChange={(e) => update({ startDate: e.target.value })} />
            </label>
            <label className="cb-pws__field">
              <span>Окончание (необязательно)</span>
              <input type="date" value={form.endDate} min={form.startDate} onChange={(e) => update({ endDate: e.target.value })} />
            </label>
          </div>

          <div className="cb-pws__field">
            <span>Пропустить даты (каникулы, праздники)</span>
            <div className="cb-pws__skip">
              <input type="date" value={skipInput} onChange={(e) => setSkipInput(e.target.value)} />
              <button type="button" className="cb-btn cb-btn--outline cb-btn--sm" onClick={addSkip} disabled={!skipInput}>Добавить</button>
            </div>
            {form.skipDates.length ? (
              <div className="cb-pws__chips">
                {form.skipDates.map((d) => (
                  <button key={d} type="button" className="cb-pws__chip is-active" onClick={() => update({ skipDates: form.skipDates.filter((x) => x !== d) })}>
                    {d.split("-").reverse().join(".")} ✕
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="cb-pws__row">
            <label className="cb-pws__field">
              <span>Формат</span>
              <select value={form.format} onChange={(e) => update({ format: e.target.value })}>
                <option value="online">Онлайн</option>
                <option value="offline">Очно</option>
              </select>
            </label>
            {form.format === "online" ? (
              <label className="cb-pws__check">
                <input type="checkbox" checked={form.video === "jitsi"} onChange={(e) => update({ video: e.target.checked ? "jitsi" : "none" })} />
                <span>Создать видеоурок на платформе</span>
              </label>
            ) : null}
            <label className="cb-pws__check">
              <input type="checkbox" checked={form.notify} onChange={(e) => update({ notify: e.target.checked })} />
              <span>Уведомить ученика о каждом занятии</span>
            </label>
            <label className="cb-pws__field">
              <span>Если время занято</span>
              <select value={form.conflictMode} onChange={(e) => update({ conflictMode: e.target.value })}>
                <option value="skip">Пропустить слот, тема — на следующий</option>
                <option value="ignore">Всё равно поставить</option>
              </select>
            </label>
          </div>
          <p className="cb-pws__hint">
            Время — {meta?.timezone || "Europe/Moscow"}. Меняются только будущие занятия, созданные этим расписанием
            и не изменённые вручную. Проведённые, отменённые, перенесённые и созданные вручную уроки остаются как есть.
          </p>

          {error ? <p className="cb-inline-error" role="alert">{error}</p> : null}
          {done ? (
            <p className="cb-pws__done" role="status">
              Готово: создано {done.created}, перенесено {done.moved}, удалено лишних {done.deleted}.
            </p>
          ) : null}

          {preview ? (
            <div className={`cb-pws__preview${previewFresh ? "" : " is-stale"}`}>
              {!previewFresh ? <p className="cb-pws__hint">Настройки изменились — обновите предпросмотр.</p> : null}
              <p className="cb-pws__summary">
                Новых: {summary.create} · перенос: {summary.move} · без изменений: {summary.unchanged}
                {" "}· уже в календаре: {summary.keep}
                {summary.remove ? ` · удалить лишних: ${summary.remove}` : ""}
                {summary.no_slot ? ` · без даты: ${summary.no_slot}` : ""}
                {summary.skipped_slots ? ` · пропущено занятых слотов: ${summary.skipped_slots}` : ""}
              </p>
              <ol className="cb-pws__list">
                {preview.rows.map((row) => (
                  <li key={row.item_id} className={`cb-pws__item cb-pws__item--${row.action}`}>
                    <span className="cb-pws__num">{row.number}</span>
                    <span className="cb-pws__topic">{row.topic}</span>
                    <span className="cb-pws__when">{formatWhen(row.starts_at)}</span>
                    <span className="cb-pws__badge">{ACTION_LABELS[row.action] || row.label}</span>
                    {row.conflicts?.length ? (
                      <span className="cb-pws__conflict">Пересекается: {row.conflicts.join(", ")}</span>
                    ) : null}
                  </li>
                ))}
              </ol>
              {preview.skipped_slots?.length ? (
                <div className="cb-pws__skipped">
                  <strong>Пропущены занятые слоты:</strong>
                  <ul>
                    {preview.skipped_slots.map((s) => (
                      <li key={s.starts_at}>{formatWhen(s.starts_at)} — {s.conflicts.join(", ")}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {preview.remove?.length ? (
                <div className="cb-pws__skipped">
                  <strong>Будут удалены лишние автозанятия:</strong>
                  <ul>
                    {preview.remove.map((r) => <li key={r.event_id}>{formatWhen(r.starts_at)} — {r.topic}</li>)}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </CabinetModal>
  );
}
