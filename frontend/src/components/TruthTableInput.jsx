import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  extractVariables,
  formatTruthTableAnswerFromGrid,
  generateCombinations,
  parseTruthTableAnswerToGrid,
  sanitizeBinaryChar,
} from "../utils/truthTable";

/**
 * @typedef {{ variables: string[]; expression: string; computed: string[]; rows: { vars: number[]; computed: string[] }[] }} TruthTableData
 */

function patchCell(grid, r, c, ch) {
  const next = grid.map((row) => [...row]);
  if (!next[r]) return grid;
  next[r] = [...next[r]];
  next[r][c] = ch;
  return next;
}

const TRUTH_NOTE =
  "Ответ засчитывается только если все значения в ячейках верные";

/**
 * Ответ для проверки: «01 00 01 00» — каждая группа = строка таблицы (все вычислимые столбцы слева направо).
 */
function TruthTableInput({
  variables: variablesProp,
  expression,
  steps,
  mode = "full-table",
  value,
  onChange,
  onTableChange,
  disabled = false,
  status = "",
}) {
  const variableList = useMemo(() => {
    if (Array.isArray(variablesProp) && variablesProp.length > 0) {
      return variablesProp.map((v) => String(v).trim()).filter(Boolean);
    }
    return extractVariables(expression);
  }, [variablesProp, expression]);

  const computedColumns = useMemo(() => {
    if (Array.isArray(steps) && steps.length > 0) {
      return steps.map((s) => String(s).trim()).filter(Boolean);
    }
    return expression ? [String(expression)] : [];
  }, [steps, expression]);

  const resultColIndex = Math.max(0, computedColumns.length - 1);
  const rowsComb = useMemo(() => generateCombinations(variableList), [variableList]);
  const numRows = rowsComb.length;
  const numComputed = computedColumns.length;

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [draft, setDraft] = useState(value ?? "");
  const [seenProp, setSeenProp] = useState(value ?? "");
  if ((value ?? "") !== seenProp) {
    setSeenProp(value ?? "");
    if ((value ?? "") !== draft) setDraft(value ?? "");
  }

  const cells = useMemo(
    () => parseTruthTableAnswerToGrid(draft, numRows, numComputed),
    [draft, numRows, numComputed]
  );

  const flatInputIndexRef = useRef(new Map());

  /** Порядок таб-цепочки: сверху вниз по каждому столбцу, столбцы слева направо */
  const flatOrder = useMemo(() => {
    const order = [];
    for (let c = 0; c < numComputed; c++) {
      for (let r = 0; r < numRows; r++) {
        const isResult = c === resultColIndex;
        const editable = mode === "full-table" ? true : isResult;
        if (editable) order.push({ r, c });
      }
    }
    return order;
  }, [numRows, numComputed, resultColIndex, mode]);

  const rcToFlatIndex = useMemo(() => {
    const m = new Map();
    flatOrder.forEach((x, i) => {
      m.set(`${x.r},${x.c}`, i);
    });
    return m;
  }, [flatOrder]);

  useEffect(() => {
    if (!onTableChange) return;
    const rowsPayload = rowsComb.map((vars, idx) => ({
      vars,
      computed: [...(cells[idx] || [])],
    }));
    onTableChange({
      variables: [...variableList],
      expression: String(expression || ""),
      computed: [...computedColumns],
      rows: rowsPayload,
    });
  }, [cells, onTableChange, rowsComb, variableList, expression, computedColumns]);

  const focusRefIndex = useCallback((idx) => {
    const el = flatInputIndexRef.current.get(idx);
    if (el && typeof el.focus === "function") el.focus();
  }, []);

  const registerFlatRef = useCallback(
    (r, c, el) => {
      const idx = rcToFlatIndex.get(`${r},${c}`);
      if (idx == null) return;
      if (el) flatInputIndexRef.current.set(idx, el);
      else flatInputIndexRef.current.delete(idx);
    },
    [rcToFlatIndex]
  );

  const publishGrid = useCallback((next, focusIndex) => {
    const serialized = formatTruthTableAnswerFromGrid(next);
    setDraft(serialized);
    if (focusIndex != null) focusRefIndex(focusIndex);
    startTransition(() => {
      onChangeRef.current?.(serialized);
    });
  }, [focusRefIndex]);

  const setCellAndAdvance = useCallback(
    (r, c, raw, advance) => {
      const ch = sanitizeBinaryChar(raw);
      const next = patchCell(cells, r, c, ch);
      let focusIndex = null;
      if (advance && ch) {
        const pos = rcToFlatIndex.get(`${r},${c}`);
        if (pos != null && pos + 1 < flatOrder.length) focusIndex = pos + 1;
      }
      publishGrid(next, focusIndex);
    },
    [cells, rcToFlatIndex, flatOrder.length, publishGrid]
  );

  const readCellDisplay = useCallback((r, c) => cells[r]?.[c] ?? "", [cells]);

  const cellsRefForKeydown = useRef(readCellDisplay);
  useEffect(() => {
    cellsRefForKeydown.current = readCellDisplay;
  }, [readCellDisplay]);

  const onTruthKeyDown = useCallback(
    (e, r, c) => {
      if (disabled) return;
      if (e.key === "Backspace") {
        const current = cellsRefForKeydown.current(r, c) ?? "";
        if (current === "") {
          e.preventDefault();
          const pos = rcToFlatIndex.get(`${r},${c}`);
          if (pos != null && pos > 0) focusRefIndex(pos - 1);
        }
      }
    },
    [disabled, rcToFlatIndex, focusRefIndex]
  );

  const onTruthPaste = useCallback(
    (e, r, c) => {
      if (disabled) return;
      const text = e.clipboardData?.getData("text") || "";
      const digits = text.replace(/[^01]/g, "");
      if (!digits) return;
      e.preventDefault();
      const start = rcToFlatIndex.get(`${r},${c}`);
      if (start == null) return;

      let next = cells.map((row) => [...row]);
      for (let k = 0; k < digits.length && start + k < flatOrder.length; k++) {
        const { r: rr, c: cc } = flatOrder[start + k];
        next = patchCell(next, rr, cc, digits[k]);
      }
      const lastFilled = Math.min(start + digits.length - 1, flatOrder.length - 1);
      publishGrid(next, lastFilled);
    },
    [disabled, cells, rcToFlatIndex, flatOrder, publishGrid]
  );

  if (numComputed === 0) return null;

  return (
    <div className={`truth-table-block${status === "ok" ? " is-ok" : ""}${status === "bad" ? " is-bad" : ""}`}>
      <p className="truth-note">{TRUTH_NOTE}</p>

      <div className="truth-table-wrap">
        <table className="truth-table">
          <thead>
            <tr>
              {variableList.map((v) => (
                <th key={v} className="truth-var-col">
                  {v}
                </th>
              ))}
              {computedColumns.map((label, idx) => {
                const isLast = idx === resultColIndex;
                return (
                  <th key={`${idx}-${label}`} className={isLast ? "result-col" : "step-col"}>
                    {label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rowsComb.map((varRow, r) => (
              <tr key={r}>
                {varRow.map((bit, j) => (
                  <td key={j} className="truth-var-cell">
                    {bit}
                  </td>
                ))}
                {computedColumns.map((label, c) => {
                  const isLast = c === resultColIndex;
                  const showInput = mode === "full-table" ? true : isLast;
                  if (showInput) {
                    return (
                      <td key={`${c}-${label}`} className={isLast ? "truth-result-cell" : "truth-step-cell"}>
                        <input
                          ref={(el) => registerFlatRef(r, c, el)}
                          type="text"
                          className={`truth-input${isLast ? " truth-result-input" : ""}`}
                          maxLength={1}
                          inputMode="numeric"
                          autoComplete="off"
                          disabled={disabled}
                          value={readCellDisplay(r, c)}
                          aria-label={`Строка ${r + 1}, ${label}`}
                          onChange={(e) => {
                            const v = e.target.value;
                            const last = v.slice(-1);
                            setCellAndAdvance(r, c, last, true);
                          }}
                          onKeyDown={(e) => onTruthKeyDown(e, r, c)}
                          onPaste={(e) => onTruthPaste(e, r, c)}
                        />
                      </td>
                    );
                  }
                  return (
                    <td key={`${c}-${label}`} className="truth-step-cell truth-step-placeholder-cell">
                      <span className="truth-step-placeholder" aria-hidden="true" />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function sameList(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((item, index) => item === b[index]);
}

export default memo(TruthTableInput, (prev, next) => (
  prev.value === next.value
  && prev.disabled === next.disabled
  && prev.status === next.status
  && prev.mode === next.mode
  && prev.expression === next.expression
  && prev.onTableChange === next.onTableChange
  && sameList(prev.variables, next.variables)
  && sameList(prev.steps, next.steps)
));
