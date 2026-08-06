import { useCallback, useMemo, useState } from "react";

/**
 * Lightweight spreadsheet collaboration view.
 * Source file is never overwritten — cell ops live in session state.
 */
export default function SpreadsheetMaterialView({
  url,
  state,
  canEdit = false,
  onCellUpdate,
  onSheetChange,
  onSelectionChange,
  remoteApplyGuard = null,
}) {
  const sheets = state?.sheets && typeof state.sheets === "object" ? state.sheets : {};
  const sheetIds = Object.keys(sheets).length ? Object.keys(sheets) : ["sheet-1"];
  const activeSheetId = state?.activeSheetId || sheetIds[0];
  const cells = sheets[activeSheetId]?.cells && typeof sheets[activeSheetId].cells === "object"
    ? sheets[activeSheetId].cells
    : {};
  const [draftCell, setDraftCell] = useState("A1");
  const [draftValue, setDraftValue] = useState("");

  const rows = useMemo(() => {
    const entries = Object.entries(cells);
    if (!entries.length) {
      return [
        { cell: "A1", value: "", formula: null },
        { cell: "B1", value: "", formula: null },
        { cell: "A2", value: "", formula: null },
        { cell: "B2", value: "", formula: null },
      ];
    }
    return entries
      .map(([cell, row]) => ({
        cell,
        value: row?.value ?? "",
        formula: row?.formula ?? null,
        author_id: row?.author_id,
        revision: row?.revision,
      }))
      .sort((a, b) => a.cell.localeCompare(b.cell));
  }, [cells]);

  const commit = useCallback(() => {
    if (!canEdit || !draftCell) return;
    if (remoteApplyGuard?.isRemote?.()) return;
    onCellUpdate?.({
      sheetId: activeSheetId,
      cell: String(draftCell).toUpperCase(),
      value: draftValue,
      formula: null,
      revision: Number(cells[String(draftCell).toUpperCase()]?.revision || 0) + 1,
    });
    onSelectionChange?.({ sheetId: activeSheetId, cell: String(draftCell).toUpperCase() });
  }, [activeSheetId, canEdit, cells, draftCell, draftValue, onCellUpdate, onSelectionChange, remoteApplyGuard]);

  return (
    <div className="vl-spreadsheet">
      <div className="vl-spreadsheet__toolbar">
        <div className="vl-spreadsheet__sheets" role="tablist" aria-label="Листы">
          {sheetIds.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={id === activeSheetId}
              className={id === activeSheetId ? "is-active" : ""}
              onClick={() => {
                if (remoteApplyGuard?.isRemote?.()) return;
                onSheetChange?.(id);
              }}
            >
              {id}
            </button>
          ))}
        </div>
        {url ? (
          <a className="vl-spreadsheet__source" href={url} target="_blank" rel="noreferrer">
            Исходный файл
          </a>
        ) : null}
      </div>
      <p className="vl-spreadsheet__hint">
        {canEdit
          ? "Изменения ячеек синхронизируются операциями. Исходный файл не перезаписывается."
          : "Просмотр таблицы. Редактирование доступно после включения совместной работы с правом «Редактирование содержимого»."}
      </p>
      <div className="vl-spreadsheet__editor">
        <label>
          Ячейка
          <input
            value={draftCell}
            onChange={(e) => setDraftCell(e.target.value)}
            disabled={!canEdit}
            maxLength={8}
          />
        </label>
        <label className="vl-spreadsheet__value">
          Значение
          <input
            value={draftValue}
            onChange={(e) => setDraftValue(e.target.value)}
            disabled={!canEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
            }}
          />
        </label>
        <button type="button" className="video-lesson-btn video-lesson-btn--primary" disabled={!canEdit} onClick={commit}>
          Применить
        </button>
      </div>
      <table className="vl-spreadsheet__table">
        <thead>
          <tr>
            <th>Ячейка</th>
            <th>Значение</th>
            <th>Ревизия</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.cell}
              className={state?.activeCell === row.cell ? "is-active" : ""}
              onClick={() => {
                setDraftCell(row.cell);
                setDraftValue(row.value == null ? "" : String(row.value));
                if (canEdit) onSelectionChange?.({ sheetId: activeSheetId, cell: row.cell });
              }}
            >
              <td>{row.cell}</td>
              <td>{row.value == null ? "" : String(row.value)}</td>
              <td>{row.revision || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
