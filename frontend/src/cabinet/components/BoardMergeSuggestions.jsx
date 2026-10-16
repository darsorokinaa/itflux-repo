import { useCallback, useEffect, useState } from "react";
import ConfirmActionModal from "./ConfirmActionModal";
import {
  fetchBoardMergeSuggestions,
  mergeInteractiveBoards,
  undoBoardMerge,
} from "../../utils/cabinetAuth";

const DISMISS_KEY = "itflux.boardMergeDismissed.v1";

function pluralBoards(n) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return "досок";
  if (last === 1) return "доску";
  if (last >= 2 && last <= 4) return "доски";
  return "досок";
}

function pluralNom(n) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return "досок";
  if (last === 1) return "доска";
  if (last >= 2 && last <= 4) return "доски";
  return "досок";
}

function readDismissed() {
  try {
    return JSON.parse(window.localStorage.getItem(DISMISS_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function suggestionKey(s) {
  // Новая доска ученика снова покажет предложение.
  return `${s.kind}:${s.ref_id}:${s.count}`;
}

/**
 * Предложение объединить доски одного ученика (или группы) в одну.
 * Старые доски становятся листами в начале, названными по дате создания.
 */
export default function BoardMergeSuggestions({ onMerged, onOpenBoard }) {
  const [items, setItems] = useState([]);
  const [dismissed, setDismissed] = useState(readDismissed);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchBoardMergeSuggestions();
      setItems(Array.isArray(data?.suggestions) ? data.suggestions : []);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const dismiss = (s) => {
    const next = { ...dismissed, [suggestionKey(s)]: Date.now() };
    setDismissed(next);
    try {
      window.localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
    } catch {
      /* приватный режим */
    }
  };

  const runMerge = async () => {
    if (!confirm) return;
    setBusy(true);
    setError("");
    try {
      const res = await mergeInteractiveBoards({
        kind: confirm.kind,
        ref_id: confirm.ref_id,
        target_id: confirm.target_id,
        board_ids: confirm.boards.map((b) => b.id),
        confirm: true,
      });
      setDone({ ...res, name: confirm.name });
      setConfirm(null);
      await load();
      onMerged?.(res);
    } catch (err) {
      setError(err?.message || "Не удалось объединить доски");
    } finally {
      setBusy(false);
    }
  };

  const runUndo = async () => {
    if (!done?.merge_id) return;
    setBusy(true);
    try {
      await undoBoardMerge(done.merge_id);
      setDone(null);
      await load();
      onMerged?.(null);
    } catch (err) {
      setError(err?.message || "Не удалось отменить объединение");
    } finally {
      setBusy(false);
    }
  };

  const visible = items.filter((s) => !dismissed[suggestionKey(s)] && s.count >= 2);

  if (!visible.length && !done) return null;

  const confirmText = confirm ? (
    <span className="cb-board-merge__confirm">
      <span>
        Все доски ({confirm.count}) {confirm.name ? `ученика «${confirm.name}»` : ""} станут одной доской
        «{confirm.target_title || "Без названия"}». Старые доски окажутся в самом начале отдельными листами,
        названными по дате создания:
      </span>
      <span className="cb-board-merge__list">
        {confirm.boards.map((b) => (
          <span key={b.id} className="cb-board-merge__row">
            {b.is_target ? "★ " : ""}{b.date_label} — {b.title || "Без названия"}
            {b.is_target ? " (основная, ссылки из уроков сохранятся)" : ""}
            {!b.is_target && b.kind === "empty" ? " (пустая — просто уйдёт в архив)" : ""}
            {!b.is_target && b.kind === "excalidraw" ? " (старая доска — будет перенесена)" : ""}
            {b.connected ? " · сейчас открыта" : ""}
          </span>
        ))}
      </span>
      <span>
        Старые доски не удаляются — они уйдут в архив, а объединение можно отменить.
      </span>
    </span>
  ) : null;

  return (
    <div className="cb-board-merge" aria-live="polite">
      {done ? (
        <div className="cb-board-merge__banner cb-board-merge__banner--done">
          <span className="cb-board-merge__text">
            Готово: доски{done.name ? ` ученика «${done.name}»` : ""} объединены — добавлено листов: {done.pages_added}.
          </span>
          <span className="cb-board-merge__actions">
            <button type="button" className="cb-btn cb-btn--primary" onClick={() => onOpenBoard?.(done.target_id)}>
              Открыть доску
            </button>
            <button type="button" className="cb-btn cb-btn--secondary" disabled={busy} onClick={runUndo}>
              Отменить объединение
            </button>
            <button type="button" className="cb-btn cb-btn--ghost" onClick={() => setDone(null)}>
              Скрыть
            </button>
          </span>
        </div>
      ) : null}
      {visible.map((s) => (
        <div key={suggestionKey(s)} className="cb-board-merge__banner" data-testid="board-merge-suggestion">
          <span className="cb-board-merge__text">
            {s.kind === "group" ? "У группы" : "У ученика"} <b>{s.name || "без имени"}</b> {s.count} {pluralNom(s.count)}.
            {" "}Можно собрать их в одну: старые доски станут листами в начале.
          </span>
          <span className="cb-board-merge__actions">
            <button type="button" className="cb-btn cb-btn--primary" onClick={() => { setError(""); setConfirm(s); }}>
              Объединить {s.count} {pluralBoards(s.count)} {s.kind === "group" ? "группы" : "ученика"} в одну
            </button>
            <button type="button" className="cb-btn cb-btn--ghost" onClick={() => dismiss(s)}>
              Не сейчас
            </button>
          </span>
        </div>
      ))}
      {error && !confirm ? <p className="cb-board-form__error" role="alert">{error}</p> : null}
      <ConfirmActionModal
        open={Boolean(confirm)}
        title={`Объединить ${confirm?.count || ""} ${pluralBoards(confirm?.count || 0)} в одну?`}
        text={(
          <>
            {confirmText}
            {error ? <span className="cb-board-form__error" role="alert">{error}</span> : null}
          </>
        )}
        confirmLabel="Объединить"
        loading={busy}
        onClose={() => { if (!busy) setConfirm(null); }}
        onConfirm={runMerge}
      />
    </div>
  );
}
