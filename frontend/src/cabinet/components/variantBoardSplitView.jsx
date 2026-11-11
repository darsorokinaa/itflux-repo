import { createPortal } from "react-dom";
import { variantBoardFrameSrc } from "./variantBoardSplitSync";
import {
  panelClassName,
  showStudentPicker,
  showStudentSelect,
  teacherBoardTitle,
} from "./variantBoardSplitHooks";

function TeacherSwitch({ board, group, students, load }) {
  if (!board || !group || students) return null;
  return (
    <span className="vb-switch" role="group" aria-label="Какая доска" data-testid="variant-board-switch">
      <button type="button" aria-pressed={board.kind !== "group"} className={board.kind !== "group" ? "is-active" : ""} onClick={() => load("mine")}>Моя доска</button>
      <button type="button" aria-pressed={board.kind === "group"} className={board.kind === "group" ? "is-active" : ""} onClick={() => load("group")}>Доска группы</button>
    </span>
  );
}

function TeacherPickList({ group, students, load }) {
  return (
    <div className="vb-board-status" data-testid="variant-board-pick">
      Чью доску открыть?
      <div className="vb-pick-list">
        {group && (
          <button type="button" className="vb-link vb-pick-group" onClick={() => load("group")}>Общая доска группы</button>
        )}
        {students.map((s) => (
          <button key={s.id} type="button" className="vb-link" onClick={() => load(s.id)}>{s.name}</button>
        ))}
      </div>
    </div>
  );
}

function TeacherBoardBody({ board, loading, error, students, group, isMobile, dragging, load }) {
  const picker = showStudentPicker(board, loading, error, students);
  return (
    <div className="vb-board-body">
      {isMobile && <TeacherSwitch board={board} group={group} students={students} load={load} />}
      {loading && <div className="vb-board-status">Открываем доску…</div>}
      {error && !loading && (
        <div className="vb-board-status vb-board-status--error">
          {error}{" "}
          <button type="button" className="vb-link" onClick={() => load()}>Повторить</button>
        </div>
      )}
      {picker && <TeacherPickList group={group} students={students} load={load} />}
      {board && !loading && (
        <iframe
          key={board.boardId}
          className="vb-board-frame"
          title={board.title || "Доска"}
          src={variantBoardFrameSrc(board.boardId)}
          data-testid="variant-board-frame"
          allow="clipboard-read; clipboard-write; fullscreen"
        />
      )}
      {dragging && <div className="vb-drag-shield" />}
    </div>
  );
}

function TeacherStudentSelect({ students, group, studentId, load }) {
  if (!showStudentSelect(students, group)) return null;
  return (
    <select
      className="vb-student-select"
      aria-label="Ученик"
      data-testid="variant-board-student"
      value={studentId ?? ""}
      onChange={(e) => e.target.value && load(e.target.value)}
    >
      <option value="" disabled>Ученик…</option>
      {group && <option value="group">Общая доска группы</option>}
      {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );
}

export function TeacherSplitPortal({ model, chrome }) {
  const { open, board, error, loading, tab, setTab, students, studentId, group, load, toggle } = model;
  const { width, isMobile, dragging, startDrag } = chrome;
  const hidden = isMobile && tab !== "board";
  return createPortal(
    <>
      {!open && (
        <button type="button" className="vb-toggle" onClick={toggle} data-testid="variant-board-toggle">
          <span aria-hidden="true">🖊</span> Доска рядом
        </button>
      )}
      {open && isMobile && (
        <div className="vb-tabs" role="tablist" data-testid="variant-board-tabs">
          <button type="button" role="tab" aria-selected={tab === "variant"} className={tab === "variant" ? "is-active" : ""} onClick={() => setTab("variant")}>Вариант</button>
          <button type="button" role="tab" aria-selected={tab === "board"} className={tab === "board" ? "is-active" : ""} onClick={() => setTab("board")}>Доска</button>
          <button type="button" className="vb-tabs-close" aria-label="Закрыть доску" onClick={toggle}>✕</button>
        </div>
      )}
      {open && (
        <aside
          className={panelClassName(isMobile, hidden)}
          style={isMobile ? undefined : { width: `${width}px` }}
          data-testid="variant-board-panel"
        >
          {!isMobile && (
            <div className="vb-divider" onPointerDown={startDrag} role="separator" aria-orientation="vertical" title="Потяните, чтобы изменить ширину" />
          )}
          {!isMobile && (
            <div className="vb-panel-head">
              <button type="button" className="vb-close" onClick={toggle} aria-label="Закрыть доску" title="Закрыть доску">✕ Закрыть</button>
              <span className="vb-panel-title">{teacherBoardTitle(board)}</span>
              <TeacherSwitch board={board} group={group} students={students} load={load} />
              <TeacherStudentSelect students={students} group={group} studentId={studentId} load={load} />
            </div>
          )}
          <TeacherBoardBody
            board={board}
            loading={loading}
            error={error}
            students={students}
            group={group}
            isMobile={isMobile}
            dragging={dragging}
            load={load}
          />
        </aside>
      )}
    </>,
    document.body,
  );
}
