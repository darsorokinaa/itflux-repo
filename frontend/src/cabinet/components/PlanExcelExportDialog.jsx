import { useEffect, useState } from "react";
import CabinetModal from "./CabinetModal";
import { WEEKDAY_OPTIONS, weekdayIndex } from "../planDates";

const MODES = [
  { id: "weekdays", label: "По выбранным дням" },
  { id: "weekly", label: "Раз в неделю" },
  { id: "biweekly", label: "Раз в две недели" },
  { id: "every_n_weeks", label: "Каждые N недель" },
  { id: "every_n_days", label: "Каждые N дней" },
  { id: "daily", label: "Каждый день" },
  { id: "manual", label: "Без автоматического расписания" },
];

function initialMode(interval) {
  if (interval === "daily") return { mode: "daily", stepN: 1 };
  if (interval === "biweekly") return { mode: "biweekly", stepN: 2 };
  if (interval === "weekly") return { mode: "weekly", stepN: 1 };
  if (interval === "manual") return { mode: "manual", stepN: 1 };
  if (String(interval || "").startsWith("every_") && interval.endsWith("_weeks")) {
    return { mode: "every_n_weeks", stepN: Number(interval.split("_")[1]) || 2 };
  }
  if (String(interval || "").startsWith("every_") && interval.endsWith("_days")) {
    return { mode: "every_n_days", stepN: Number(interval.split("_")[1]) || 1 };
  }
  return { mode: "weekdays", stepN: 1 };
}

export default function PlanExcelExportDialog({
  open,
  kind = "plan",
  initial,
  onClose,
  onConfirm,
}) {
  const [mode, setMode] = useState("weekdays");
  const [weekdays, setWeekdays] = useState([]);
  const [startDate, setStartDate] = useState("");
  const [stepN, setStepN] = useState(1);
  const [startTime, setStartTime] = useState("16:00");
  const [duration, setDuration] = useState(60);

  useEffect(() => {
    if (!open) return;
    const next = initialMode(initial?.interval);
    const days = Array.isArray(initial?.weekdays) ? [...initial.weekdays] : [];
    if (!days.length && startOrEmpty(initial?.startDate) && next.mode === "weekdays") {
      const index = weekdayIndex(initial.startDate);
      if (index != null) days.push(index);
    }
    setMode(next.mode);
    setStepN(initial?.stepN || next.stepN);
    setWeekdays(days);
    setStartDate(initial?.startDate || "");
    setStartTime(initial?.startTime || "16:00");
    setDuration(initial?.duration || 60);
  }, [initial, open]);

  if (!open) return null;

  const showDays = mode === "weekdays";
  const showStep = mode === "every_n_weeks" || mode === "every_n_days";
  const manual = mode === "manual";

  const toggleDay = (day) => {
    setWeekdays((prev) => (
      prev.includes(day) ? prev.filter((value) => value !== day) : [...prev, day]
    ));
  };

  return (
    <CabinetModal
      title={kind === "template" ? "Шаблон Excel" : "Скачать Excel"}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="cb-btn cb-btn--ghost" onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            className="cb-btn cb-btn--primary"
            onClick={() => onConfirm({
              schedule_mode: mode,
              interval: mode === "weekdays" ? "weekdays" : mode,
              weekdays: showDays ? weekdays : [],
              start_date: startDate,
              step_n: showStep ? stepN : "",
              start_time: startTime,
              duration_minutes: duration,
            })}
          >
            Скачать
          </button>
        </>
      )}
    >
      <div className="cb-excel-setup">
        <p className="cb-excel-setup__lead">
          Эти параметры попадут в файл. Их можно изменить перед каждой выгрузкой.
        </p>
        <label className="cb-pe-field">
          <span>Дата первого занятия</span>
          <input
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </label>
        <label className="cb-pe-field">
          <span>Как считать даты</span>
          <select value={mode} onChange={(event) => setMode(event.target.value)} aria-label="Как считать даты">
            {MODES.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>
        {showStep ? (
          <label className="cb-pe-field">
            <span>{mode === "every_n_weeks" ? "Каждые N недель" : "Каждые N дней"}</span>
            <input
              type="number"
              min={1}
              max={52}
              value={stepN}
              onChange={(event) => setStepN(Math.max(1, Number(event.target.value) || 1))}
            />
          </label>
        ) : null}
        {showDays ? (
          <div>
            <span className="cb-excel-setup__label">Учебные дни</span>
            <div className="cb-excel-setup__days" role="group" aria-label="Учебные дни">
              {WEEKDAY_OPTIONS.map((day) => {
                const selected = weekdays.includes(day.id);
                return (
                  <button
                    key={day.id}
                    type="button"
                    className={`cb-excel-setup__day${selected ? " is-on" : ""}`}
                    aria-pressed={selected}
                    onClick={() => toggleDay(day.id)}
                  >
                    {day.short}
                  </button>
                );
              })}
            </div>
            {!weekdays.length ? (
              <p className="cb-excel-setup__note">Дни не выбраны: даты в файле не рассчитаются, пока не отметите хотя бы один.</p>
            ) : null}
          </div>
        ) : null}
        {manual ? (
          <p className="cb-excel-setup__note">Даты в файле не заполнятся сами. Их можно указать в столбце «Дата вручную».</p>
        ) : null}
        <div className="cb-excel-setup__time">
          <label className="cb-pe-field">
            <span>Время начала</span>
            <input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
          </label>
          <label className="cb-pe-field">
            <span>Минуты</span>
            <input
              type="number"
              min={15}
              step={15}
              value={duration}
              aria-label="Продолжительность"
              onChange={(event) => setDuration(Number(event.target.value) || 60)}
            />
          </label>
        </div>
      </div>
    </CabinetModal>
  );
}

function startOrEmpty(value) {
  return Boolean(value);
}
