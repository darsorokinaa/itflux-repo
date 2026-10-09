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
  onSelectionChange,
}) {
  const [mode, setMode] = useState(() => preview?.mode || "sync");
  const [replaceAck, setReplaceAck] = useState(false);
  const [confirmDeletes, setConfirmDeletes] = useState(false);
  const [excluded, setExcluded] = useState(() => new Set());
  const [accepted, setAccepted] = useState(() => new Set());
  const [deleteExcluded, setDeleteExcluded] = useState(() => new Set());
  const [moves, setMoves] = useState(() => new Set());
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

  const sync = mode === "sync";
  const hint = useMemo(() => {
    if (!canImport) return "Исправьте ошибки в файле и загрузите его снова. Пока есть критическая ошибка, план не изменится.";
    if (sync) return preview?.confirmation || "Будут применены только показанные изменения. Повторная загрузка того же файла ничего не дублирует.";
    if (preview?.confirmation) return preview.confirmation;
    if (mode === "insert") return "Уроки из файла будут добавлены на указанные даты. Последующие занятия сдвинутся согласно расписанию.";
    if (mode === "replace_dates") return "Содержимое уроков на указанных датах будет заменено данными из Excel.";
    return "Текущий список уроков будет полностью заменён содержимым Excel-файла.";
  }, [canImport, mode, preview?.confirmation, sync]);

  const confirmMeta = sync
    ? { confirmLabel: "Применить изменения" }
    : (MODES.find((item) => item.id === mode) || MODES[0]);
  const confirmDisabled = !canImport || busy || (!sync && mode === "replace_all" && hasExistingLessons && !replaceAck);

  const handleModeChange = (nextMode) => {
    if (nextMode === mode || busy) return;
    setMode(nextMode);
    setReplaceAck(false);
    setExcluded(new Set());
    setAccepted(new Set());
    setDeleteExcluded(new Set());
    setMoves(new Set());
    onModeChange?.(nextMode);
  };

  const emitSelection = (nextExcluded, nextAccepted, nextDeletes, nextMoves) => {
    onSelectionChange?.({
      excludeRows: [...nextExcluded, ...[...nextDeletes].map((id) => `delete:${id}`)],
      acceptConflicts: [...nextAccepted],
      moveEventRows: [...nextMoves],
    });
  };

  const selectionOptions = () => ({
    confirmDeletes: mode === "sync" ? confirmDeletes : false,
    excludeRows: [...excluded, ...[...deleteExcluded].map((id) => `delete:${id}`)],
    acceptConflicts: [...accepted],
    moveEventRows: [...moves],
  });

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
            onClick={() => onConfirm(mode, sync ? selectionOptions() : { confirmDeletes: false })}
          >
            {loading ? "Импорт…" : previewLoading ? "Обновление…" : confirmMeta.confirmLabel}
          </button>
        </>
      )}
    >
      <div className="cb-pe-excel">
        {hasExistingLessons && !sync ? (
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

        {sync && summary.deleted ? (
          <label className="cb-pe-excel__ack">
            <input
              type="checkbox"
              checked={confirmDeletes}
              disabled={busy || !canImport}
              onChange={(event) => setConfirmDeletes(event.target.checked)}
            />
            <span>
              Удалить из плана занятия, которых нет в файле. Если урок уже стоит в расписании, его нужно отдельно проверить и при необходимости отменить.
            </span>
          </label>
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
                {sync ? <th>Применить</th> : null}
                <th>Строка</th>
                <th>Дата</th>
                <th>Название</th>
                <th>Тема</th>
                <th>Результат</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={`${row.excel_row || "plan"}-${row.current_id || row.item?.title || ""}`} className={`cb-pe-excel__row cb-pe-excel__row--${row.status}`}>
                  {sync ? (
                    <td>
                      <RowChoice
                        row={row}
                        busy={busy}
                        excluded={excluded}
                        accepted={accepted}
                        deleteExcluded={deleteExcluded}
                        moves={moves}
                        onToggle={(kind, id, checked) => {
                          if (kind === "delete") {
                            const nextDeletes = new Set(deleteExcluded);
                            if (checked) nextDeletes.delete(id);
                            else nextDeletes.add(id);
                            setDeleteExcluded(nextDeletes);
                            emitSelection(excluded, accepted, nextDeletes, moves);
                            return;
                          }
                          if (kind === "conflict") {
                            const nextAccepted = new Set(accepted);
                            const nextExcluded = new Set(excluded);
                            if (checked) nextAccepted.add(id);
                            else nextAccepted.delete(id);
                            nextExcluded.delete(id);
                            setAccepted(nextAccepted);
                            setExcluded(nextExcluded);
                            emitSelection(nextExcluded, nextAccepted, deleteExcluded, moves);
                            return;
                          }
                          if (kind === "move") {
                            const nextMoves = new Set(moves);
                            if (checked) nextMoves.add(id);
                            else nextMoves.delete(id);
                            setMoves(nextMoves);
                            return;
                          }
                          const nextExcluded = new Set(excluded);
                          if (checked) nextExcluded.delete(id);
                          else nextExcluded.add(id);
                          setExcluded(nextExcluded);
                          emitSelection(nextExcluded, accepted, deleteExcluded, moves);
                        }}
                      />
                    </td>
                  ) : null}
                  <td>{row.excel_row || "—"}</td>
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
                    {(row.diffs || []).map((diff) => (
                      <div key={diff.field} className="cb-pe-excel__msg">
                        {diff.label}: на сайте «{diff.site || "—"}», в файле «{diff.file || "—"}»
                      </div>
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

function RowChoice({ row, busy, excluded, accepted, deleteExcluded, moves, onToggle }) {
  if (row.allow_create && row.excel_row) {
    return (
      <div className="cb-pe-excel__choice">
        <label>
          <input
            type="checkbox"
            checked={accepted.has(row.excel_row)}
            disabled={busy}
            aria-label="Создать как новое занятие"
            onChange={(event) => onToggle("conflict", row.excel_row, event.target.checked)}
          />
          <span>Создать как новое занятие</span>
        </label>
      </div>
    );
  }
  const status = row.status;
  const isDelete = status === "delete" || (status === "excluded" && !row.excel_row && row.current_id);
  const isConflict = status === "conflict" || (row.conflict && row.resolution !== "file" && !accepted.has(row.excel_row));
  const selectable = isDelete || ["create", "update", "warning", "excluded", "conflict"].includes(status);
  if (!selectable || status === "unchanged" || status === "retain" || status === "ambiguous" || status === "error") {
    return null;
  }
  let checked = false;
  if (isDelete) checked = !deleteExcluded.has(row.current_id);
  else if (isConflict) checked = accepted.has(row.excel_row);
  else if (status === "excluded") checked = false;
  else checked = !excluded.has(row.excel_row);
  const label = isConflict ? "Взять версию из файла" : "Применить";
  return (
    <div className="cb-pe-excel__choice">
      <label>
        <input
          type="checkbox"
          checked={checked}
          disabled={busy}
          aria-label={label}
          onChange={(event) => onToggle(
            isDelete ? "delete" : (row.conflict || row.status === "conflict") ? "conflict" : "row",
            isDelete ? row.current_id : row.excel_row,
            event.target.checked,
          )}
        />
        <span>{label}</span>
      </label>
      {row.event_move && checked ? (
        row.event_move.can_move ? (
          <label>
            <input
              type="checkbox"
              checked={moves.has(row.excel_row)}
              disabled={busy}
              onChange={(event) => onToggle("move", row.excel_row, event.target.checked)}
            />
            <span>Перенести событие в календаре</span>
          </label>
        ) : (
          <span className="cb-pe-excel__msg">{row.event_move.reason}</span>
        )
      ) : null}
    </div>
  );
}

function ModeSummary({ mode, summary, shifts }) {
  if (mode === "sync") {
    return (
      <div className="cb-pe-excel__stats">
        <Stat label="Без изменений" value={summary.unchanged || 0} />
        <Stat label="Обновятся" value={summary.updated || 0} />
        <Stat label="Добавятся" value={summary.added || 0} />
        <Stat label="Удалятся" value={summary.deleted || 0} />
        <Stat label="Даты" value={summary.dates_changed || 0} />
        <Stat label="Нужно внимание" value={summary.attention || 0} />
        {summary.conflicts ? <Stat label="Конфликт с сайтом" value={summary.conflicts} /> : null}
      </div>
    );
  }
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
