import { useState } from "react";
import { variantBoardFrameSrc } from "./variantBoardSplitSync";

function ShowBoardChip({ onExpand }) {
  return (
    <button type="button" className="vb-toggle" onClick={onExpand} data-testid="variant-board-show">
      Показать доску
    </button>
  );
}

function boardTitle(kind) {
  return kind === "group" ? "Доска группы" : "Доска";
}

function useBoardTab(boardId) {
  const [tabState, setTabState] = useState({ boardId, tab: "board" });
  const tab = tabState.boardId === boardId ? tabState.tab : "board";
  const setTab = (next) => setTabState({ boardId, tab: next });
  return [tab, setTab];
}

function MobileTabs({ tab, setTab, onCollapse }) {
  return (
    <div className="vb-tabs" role="tablist" data-testid="variant-board-tabs">
      <button
        type="button"
        role="tab"
        aria-selected={tab === "variant"}
        className={tab === "variant" ? "is-active" : ""}
        onClick={() => setTab("variant")}
      >
        Вариант
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === "board"}
        className={tab === "board" ? "is-active" : ""}
        onClick={() => setTab("board")}
      >
        Доска
      </button>
      <button type="button" className="vb-tabs-close" aria-label="Скрыть доску" onClick={onCollapse}>
        ✕
      </button>
    </div>
  );
}

function DesktopChrome({ title, onCollapse, onDragStart }) {
  return (
    <>
      <div
        className="vb-divider"
        onPointerDown={onDragStart}
        role="separator"
        aria-orientation="vertical"
        title="Потяните, чтобы изменить ширину"
      />
      <div className="vb-panel-head">
        <button type="button" className="vb-close" onClick={onCollapse} aria-label="Скрыть доску" title="Скрыть доску">
          ✕ Скрыть
        </button>
        <span className="vb-panel-title">{title}</span>
      </div>
    </>
  );
}

function BoardFrame({ boardId, title, dragging }) {
  return (
    <div className="vb-board-body">
      <iframe
        key={boardId}
        className="vb-board-frame"
        title={title}
        src={variantBoardFrameSrc(boardId)}
        data-testid="variant-board-frame"
        allow="clipboard-read; clipboard-write; fullscreen"
      />
      {dragging ? <div className="vb-drag-shield" /> : null}
    </div>
  );
}

function OpenStudentPanel({ split, tab, setTab, width, isMobile, dragging, onDragStart, onCollapse }) {
  const title = boardTitle(split.kind);
  const hidePanel = isMobile && tab !== "board";
  const panelClass = [
    "vb-panel",
    isMobile ? "vb-panel--mobile" : "",
    hidePanel ? "vb-panel--hidden" : "",
  ].filter(Boolean).join(" ");
  return (
    <>
      {isMobile ? <MobileTabs tab={tab} setTab={setTab} onCollapse={onCollapse} /> : null}
      <aside
        className={panelClass}
        style={isMobile ? undefined : { width: `${width}px` }}
        data-testid="variant-board-panel"
      >
        {isMobile ? null : (
          <DesktopChrome title={title} onCollapse={onCollapse} onDragStart={onDragStart} />
        )}
        <BoardFrame boardId={split.boardId} title={title} dragging={dragging} />
      </aside>
    </>
  );
}

export default function StudentSplitChrome({
  split, collapsed, onCollapse, onExpand, width, isMobile, dragging, onDragStart,
}) {
  const [tab, setTab] = useBoardTab(split?.boardId || "");
  if (!split) return null;
  if (collapsed) return <ShowBoardChip onExpand={onExpand} />;
  return (
    <OpenStudentPanel
      split={split}
      tab={tab}
      setTab={setTab}
      width={width}
      isMobile={isMobile}
      dragging={dragging}
      onDragStart={onDragStart}
      onCollapse={onCollapse}
    />
  );
}
