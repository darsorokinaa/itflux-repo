import { useRef, useState } from "react";

import CabinetIcon from "../CabinetIcons";
import BoardLessonBlock from "./BoardLessonBlock";
import CabinetFloatingMenu from "./CabinetFloatingMenu";
import LiveVariantAnswersTable from "./LiveVariantAnswersTable";
import LiveMaterialAnswersTable from "./LiveMaterialAnswersTable";

function kindIcon(kind) {
  if (kind === "board") return "board";
  if (kind === "variant" || kind === "interactive") return "quiz";
  if (kind === "file" || kind === "library_lesson") return "note";
  if (kind === "notes") return "book";
  return "folder";
}

function isRowShowing(row, presented, materialSession) {
  if (!row) return false;
  if (materialSession?.material) {
    const m = materialSession.material;
    if (row.materialId && m.id && Number(row.materialId) === Number(m.id)) return true;
    if (row.interactiveId && m.interactiveId && Number(row.interactiveId) === Number(m.interactiveId)) {
      return true;
    }
    if (row.label && m.title && row.label === m.title && row.url && m.openUrl) {
      return String(m.openUrl).includes(String(row.url).split("?")[0]);
    }
  }
  if (!presented?.kind) return false;
  if (row.kind === "board" && presented.kind === "board") {
    return Boolean(row.boardId && String(presented.boardId) === String(row.boardId));
  }
  if (row.kind === "variant" && presented.kind === "variant") {
    return Boolean(
      (row.materialId && presented.materialId === row.materialId)
      || (presented.title && presented.title === row.label)
      || (
        row.url
        && presented.openUrl
        && String(presented.openUrl).includes(String(row.url).split("?")[0])
      ),
    );
  }
  return false;
}

function canPresentRow(row) {
  if (!row) return false;
  if (row.kind === "variant" || row.kind === "board") return true;
  // Остальные материалы синхронизируются через material session.
  return row.kind !== "board";
}

function MaterialRow({
  row,
  canManage,
  presented,
  materialSession = null,
  presentBusy,
  removeBusy = false,
  menuKey,
  setMenuKey,
  onOpen,
  onToggleVisibility,
  onOpenInNewTab,
  onRemove = null,
}) {
  const showing = isRowShowing(row, presented, materialSession);
  const presentable = canPresentRow(row);
  const removable = Boolean(canManage && onRemove && (row.materialId || row.interactiveId));
  const menuOpen = menuKey === row.key;
  const btnRef = useRef(null);

  return (
    <li className={`vl-mat-item${showing ? " is-showing" : ""}`}>
      <button
        type="button"
        className="vl-mat-item__main vl-mat-item__main--button"
        onClick={() => onOpen(row)}
      >
        <span className="vl-mat-item__icon" aria-hidden="true">
          <CabinetIcon name={kindIcon(row.kind)} />
        </span>
        <div className="vl-mat-item__body">
          <div className="vl-mat-item__title">{row.label}</div>
          <div className="vl-mat-item__meta">
            {row.typeLabel || "Материал"}
            {canManage && presentable ? (
              <span className={`vl-mat-item__vis ${showing ? "is-on" : "is-off"}`}>
                {showing ? "Показан ученику" : "Скрыт от ученика"}
              </span>
            ) : null}
          </div>
        </div>
      </button>
      <div className="vl-mat-item__actions">
        <div className="vl-mat-item__menu-wrap">
          <button
            ref={btnRef}
            type="button"
            className="video-lesson-icon-btn"
            aria-label="Действия с материалом"
            aria-expanded={menuOpen}
            title="Ещё"
            onClick={() => setMenuKey(menuOpen ? "" : row.key)}
          >
            <span aria-hidden="true">•••</span>
          </button>
          <CabinetFloatingMenu
            open={menuOpen}
            anchorEl={btnRef.current}
            onClose={() => setMenuKey("")}
            className="vl-dropdown"
            width={220}
          >
            {(row.url || row.kind === "board" || row.text) ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuKey("");
                  onOpen(row);
                }}
              >
                Открыть
              </button>
            ) : null}
            {row.url ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuKey("");
                  onOpenInNewTab(row);
                }}
              >
                Открыть в новой вкладке
              </button>
            ) : null}
            {canManage && presentable ? (
              <button
                type="button"
                role="menuitem"
                disabled={presentBusy}
                onClick={() => {
                  setMenuKey("");
                  onToggleVisibility(row, showing);
                }}
              >
                {showing ? "Скрыть от ученика" : "Показать ученику"}
              </button>
            ) : null}
            {removable ? (
              <button
                type="button"
                role="menuitem"
                className="is-danger"
                disabled={removeBusy || presentBusy}
                onClick={() => {
                  setMenuKey("");
                  onRemove(row);
                }}
              >
                Убрать с урока
              </button>
            ) : null}
          </CabinetFloatingMenu>
        </div>
      </div>
    </li>
  );
}

/**
 * Боковая панель материалов урока (учитель / ученик).
 */
export default function VideoLessonMaterialsPanel({
  canManage,
  materialRows,
  homeworkRows,
  boardRow = null,
  presented,
  materialSession = null,
  presentBusy,
  removeBusy = false,
  event,
  liveAnswers,
  liveAnswersLoading,
  materialPresence = [],
  attachError = "",
  toast = "",
  onClose,
  onAddMenuAction,
  onOpenRow,
  onToggleVisibility,
  onOpenInNewTab,
  onRemoveRow = null,
  onShowBoard,
  onOpenBoardLocally,
  onHidePresented,
  onBoardPresenceChange,
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [menuKey, setMenuKey] = useState("");
  const addBtnRef = useRef(null);

  const allRows = [
    ...(boardRow ? [boardRow] : []),
    ...materialRows,
    ...homeworkRows.map((r) => ({ ...r, typeLabel: r.typeLabel ? `ДЗ · ${r.typeLabel}` : "ДЗ" })),
  ];
  const count = allRows.length;

  return (
    <aside className="video-lesson-aside" aria-label="Материалы урока">
      <div className="video-lesson-aside__header">
        <div className="video-lesson-aside__header-text">
          <h2 className="video-lesson-aside__title">
            Материалы урока
            {count ? <span className="video-lesson-aside__count"> · {count}</span> : null}
          </h2>
        </div>
        <div className="video-lesson-aside__header-actions">
          {canManage ? (
            <div className="vl-add-wrap">
              <button
                ref={addBtnRef}
                type="button"
                className="video-lesson-btn video-lesson-btn--primary"
                aria-expanded={addOpen}
                onClick={() => {
                  setMenuKey("");
                  setAddOpen((v) => !v);
                }}
              >
                <CabinetIcon name="plus" />
                <span>Добавить материал</span>
              </button>
              <CabinetFloatingMenu
                open={addOpen}
                anchorEl={addBtnRef.current}
                onClose={() => setAddOpen(false)}
                className="vl-dropdown vl-dropdown--add"
                align="left"
                width={220}
              >
                {[
                  ["library", "Из библиотеки"],
                  ["file", "Файл"],
                  ["link", "Ссылка"],
                  ["variant", "Задание / вариант"],
                  ["interactive", "Интерактив"],
                  ["homework", "Домашнее задание"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setAddOpen(false);
                      onAddMenuAction(id);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </CabinetFloatingMenu>
            </div>
          ) : null}
          <button
            type="button"
            className="video-lesson-icon-btn"
            aria-label="Закрыть материалы"
            title="Закрыть"
            onClick={onClose}
          >
            <CabinetIcon name="close" />
          </button>
        </div>
      </div>

      {toast ? (
        <p className="vl-aside-toast" role="status">{toast}</p>
      ) : null}
      {attachError ? (
        <p className="vl-aside-error" role="alert">{attachError}</p>
      ) : null}

      <div className="video-lesson-aside__scroll">
        {!count && canManage ? (
          <div className="vl-empty">
            <p className="vl-empty__title">Материалов пока нет</p>
            <p className="vl-empty__text">
              Добавьте файл, ссылку, задание или интерактив для этого урока.
            </p>
            <button
              type="button"
              className="video-lesson-btn video-lesson-btn--primary"
              onClick={() => onAddMenuAction("library")}
            >
              Добавить материал
            </button>
          </div>
        ) : null}

        {!count && !canManage ? (
          <div className="vl-empty">
            <p className="vl-empty__title">Учитель пока не добавил материалы</p>
          </div>
        ) : null}

        {count ? (
          <ul className="vl-mat-list">
            {allRows.map((row) => (
              <MaterialRow
                key={row.key}
                row={row}
                canManage={canManage}
                presented={presented}
                materialSession={materialSession}
                presentBusy={presentBusy}
                removeBusy={removeBusy}
                menuKey={menuKey}
                setMenuKey={(key) => {
                  setAddOpen(false);
                  setMenuKey(key);
                }}
                onOpen={onOpenRow}
                onToggleVisibility={onToggleVisibility}
                onOpenInNewTab={onOpenInNewTab}
                onRemove={onRemoveRow}
              />
            ))}
          </ul>
        ) : null}

        {canManage && event?.id ? (
          <div className="vl-board-slot">
            <BoardLessonBlock
              embedded
              scheduleEventId={event.id}
              lessonId={event.lessonId || event.lesson || null}
              lessonTitle={event.topic || event.eventTitle || ""}
              studentId={event.studentId || event.student || null}
              groupId={event.groupId || event.group || null}
              studentMode={false}
              onShowToStudent={onShowBoard}
              onOpenLocally={onOpenBoardLocally}
              onHideFromStudent={onHidePresented}
              showingToStudent={presented?.kind === "board"}
              showBusy={presentBusy}
              onPresenceChange={onBoardPresenceChange}
            />
          </div>
        ) : null}

        {canManage && presented?.kind === "variant" ? (
          <section className="video-lesson-aside__section video-lesson-aside__section--live">
            <LiveVariantAnswersTable answers={liveAnswers} loading={liveAnswersLoading} compact />
          </section>
        ) : null}

        {canManage && materialSession?.state ? (
          <section className="video-lesson-aside__section video-lesson-aside__section--live">
            <LiveMaterialAnswersTable
              state={materialSession.state}
              presence={materialPresence}
              compact
            />
          </section>
        ) : null}
      </div>
    </aside>
  );
}
