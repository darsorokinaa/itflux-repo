import { useEffect, useMemo, useState } from "react";
import CabinetModal from "./CabinetModal";
import { lessonsWord } from "../planEditorGrouping";
import { formatPlanDateNumeric } from "../planDates";

function countLabel(n) {
  const count = Number(n) || 0;
  return `${count} ${lessonsWord(count)}`;
}

const MODES = [
  {
    id: "replace_all",
    title: "Обновить план целиком",
    description: "Полностью заменить текущий список уроков содержимым Excel-файла.",
    confirmLabel: "Обновить план целиком",
  },
  {
    id: "insert",
    title: "Добавить уроки",
    description: "Вставить уроки на указанные даты. Последующие занятия сдвинутся согласно расписанию.",
    confirmLabel: "Добавить уроки",
  },
  {
    id: "replace_dates",
    title: "Заменить уроки по датам",
    description: "Заменить существующие уроки, которые уже стоят на указанных в Excel датах.",
    confirmLabel: "Заменить уроки по датам",
  },
];

function resultLines(row) {
  const text = String(row?.result || "").trim();
  if (text) return text.split("\n").filter(Boolean);
  if (row?.status === "error") return ["Ошибка"];
  return [];
}

export default function PlanExcelImportModal({
  preview,
  hasExistingLessons,
  loading,
  previewLoading,
  onClose,
  onConfirm,
  onModeChange,
}) {
  const [mode, setMode] = useState(() => preview?.mode || (hasExistingLessons ? "replace_all" : "replace_all"));
  const [replaceAck, setReplaceAck] = useState(false);
  const rows = preview?.rows || [];
  const summary = preview?.summary || {};
  const visibleRows = rows.slice(0, 40);
  const hiddenCount = Math.max(0, rows.length - visibleRows.length);
  const canImport = Boolean(preview?.can_import);
  const busy = Boolean(loading || previewLoading);

  useEffect(() => {
    if (preview?.mode && preview.mode !== mode) {
      setMode(preview.mode);
      setReplaceAck(false);
    }
  }, [mode, preview?.mode]);

  const hint = useMemo(() => {
    if (!canImport) return "Исправьте ошибки в файле и загрузите его снова. Пока есть критическая ошибка, план не изменится.";
    if (preview?.confirmation) return preview.confirmation;
    if (mode === "insert") return "Уроки из файла будут добавлены на указанные даты. Последующие занятия сдвинутся согласно расписанию.";
    if (mode === "replace_dates") return "Содержимое уроков на указанных датах будет заменено данными из Excel.";
    return "Текущий список уроков будет полностью заменён содержимым Excel-файла.";
  }, [canImport, mode, preview?.confirmation]);

  const confirmMeta = MODES.find((item) => item.id === mode) || MODES[0];
  const confirmDisabled = !canImport || busy || (mode === "replace_all" && hasExistingLessons && !replaceAck);

  const handleModeChange = (nextMode) => {
    if (nextMode === mode || busy) return;
    setMode(nextMode);
    setReplaceAck(false);
    onModeChange?.(nextMode);
  };

  return (
    <CabinetModal
      title="Предпросмотр импорта"
      wide
      onClose={busy ? undefined : onClose}
      footer={(
        <>
          <button type="button" className="cb-btn cb-btn--ghost" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button
            type="button"
            className={`cb-btn ${mode === "replace_all" ? "cb-btn--danger" : "cb-btn--primary"}`}
            disabled={confirmDisabled}
            onClick={() => onConfirm(mode)}
          >
            {loading ? "Импорт…" : previewLoading ? "Обновление…" : confirmMeta.confirmLabel}
          </button>
        </>
      )}
    >
      <div className="cb-pe-excel">
        {hasExistingLessons ? (
          <fieldset className="cb-pe-excel__modes">
            <legend>Как применить файл?</legend>
            {MODES.map((item) => (
              <label key={item.id} className={`cb-pe-excel__mode${mode === item.id ? " is-active" : ""}`}>
                <input
                  type="radio"
                  name="excel-mode"
                  checked={mode === item.id}
                  disabled={busy}
                  onChange={() => handleModeChange(item.id)}
                />
                <span className="cb-pe-excel__mode-copy">
                  <span className="cb-pe-excel__mode-title">{item.title}</span>
                  <span className="cb-pe-excel__mode-desc">{item.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
        ) : null}

        <ModeSummary mode={mode} summary={summary} shifts={preview?.shifts || []} />

        {preview?.blocking_errors?.length ? (
          <ul className="cb-pe-excel__notes cb-pe-excel__notes--error">
            {preview.blocking_errors.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
        {preview?.warnings?.length ? (
          <ul className="cb-pe-excel__notes">
            {preview.warnings.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}

        {mode === "replace_all" && hasExistingLessons ? (
          <label className="cb-pe-excel__ack">
            <input
              type="checkbox"
              checked={replaceAck}
              disabled={busy || !canImport}
              onChange={(e) => setReplaceAck(e.target.checked)}
            />
            <span>{hint}</span>
          </label>
        ) : (
          <p className="cb-pe-excel__hint">{hint}</p>
        )}

        {mode === "insert" && (preview?.shifts || []).length ? (
          <p className="cb-pe-excel__hint">Последующие автоматические даты будут пересчитаны.</p>
        ) : null}

        <div className="cb-pe-excel__table-wrap">
          <table className="cb-pe-excel__table">
            <thead>
              <tr>
                <th>Строка</th>
                <th>Дата</th>
                <th>Название</th>
                <th>Тема</th>
                <th>Результат</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.excel_row} className={`cb-pe-excel__row cb-pe-excel__row--${row.status}`}>
                  <td>{row.excel_row}</td>
                  <td>{row.item?.scheduled_date ? formatPlanDateNumeric(row.item.scheduled_date) : "авто"}</td>
                  <td>{row.item?.title || "—"}</td>
                  <td>{row.item?.topic || "—"}</td>
                  <td>
                    {resultLines(row).map((line) => (
                      <div key={line}>{line}</div>
                    ))}
                    {(row.messages || []).map((message) => (
                      <div key={message} className="cb-pe-excel__msg">{message}</div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {hiddenCount > 0 ? (
          <p className="cb-pe-excel__more">Показаны первые {visibleRows.length} строк, ещё {hiddenCount}.</p>
        ) : null}
      </div>
    </CabinetModal>
  );
}

function ModeSummary({ mode, summary, shifts }) {
  if (mode === "replace_all") {
    const current = summary.current_count || 0;
    return (
      <div className="cb-pe-excel__stats">
        <Stat label="В файле" value={countLabel(summary.file_count || summary.found || 0)} />
        <Stat label="Сейчас в плане" value={countLabel(current)} />
        <Stat label="После импорта" value={countLabel(summary.after_count || 0)} />
        <p className="cb-pe-excel__note">
          {current === 1
            ? "Текущий урок будет заменён содержимым Excel-файла."
            : `${countLabel(current)} будут заменены содержимым Excel-файла.`}
        </p>
      </div>
    );
  }
  if (mode === "insert") {
    return (
      <div className="cb-pe-excel__stats">
        <Stat label="Будет добавлено" value={countLabel(summary.added || 0)} />
        <p className="cb-pe-excel__note">
          Последующие уроки будут сдвинуты согласно расписанию плана.
        </p>
        {shifts.length ? (
          <ul className="cb-pe-excel__shifts">
            {shifts.slice(0, 8).map((item) => (
              <li key={`${item.id}-${item.to}`}>
                {item.title || "Урок"}: {item.from ? formatPlanDateNumeric(item.from) : "—"} → {item.to ? formatPlanDateNumeric(item.to) : "—"}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }
  return (
    <div className="cb-pe-excel__stats">
      <Stat label="Будет заменено" value={countLabel(summary.replaced || 0)} />
      <Stat label="Добавлено" value="0" />
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="cb-pe-excel__stat">
      <span className="cb-pe-excel__stat-label">{label}</span>
      <strong className="cb-pe-excel__stat-value">{value}</strong>
    </div>
  );
}
