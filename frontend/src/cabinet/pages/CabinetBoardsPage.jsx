import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CabinetPageHeader, CabinetPageShell, useSoonToast } from "../CabinetSectionUi";
import BoardCreateModal from "../components/BoardCreateModal";
import CabinetModal from "../components/CabinetModal";
import ConfirmActionModal from "../components/ConfirmActionModal";
import {
  deleteInteractiveBoard,
  duplicateInteractiveBoard,
  fetchGroups,
  fetchInteractiveBoards,
  fetchStudents,
  normalizeCabinetList,
  updateInteractiveBoard,
} from "../../utils/cabinetAuth";
import "../styles/boards.css";

const SEARCH_DEBOUNCE_MS = 300;

function pluralRu(n, one, few, many) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function formatRelativeUpdated(value) {
  if (!value) return "—";
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    const diffSec = Math.round((Date.now() - date.getTime()) / 1000);
    if (diffSec < 45) return "только что";
    const mins = Math.round(diffSec / 60);
    if (mins < 60) return `${mins} ${pluralRu(mins, "минуту", "минуты", "минут")} назад`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} ${pluralRu(hours, "час", "часа", "часов")} назад`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days} ${pluralRu(days, "день", "дня", "дней")} назад`;
    return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "—";
  }
}

function boardWorkspaceLabel(board) {
  if (board.student_name) return board.student_name;
  if (board.group_title) return board.group_title;
  if (board.owner_name) return `${board.owner_name}`;
  return "Рабочее пространство";
}

export default function CabinetBoardsPage() {
  const navigate = useNavigate();
  const { toast } = useSoonToast();
  const [items, setItems] = useState([]);
  const [groups, setGroups] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [studentFilter, setStudentFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState("");
  const [renameBoard, setRenameBoard] = useState(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState("");
  const [deleteBoard, setDeleteBoard] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [menuBoardId, setMenuBoardId] = useState(null);
  const menuRef = useRef(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!menuBoardId) return undefined;
    const onDoc = (e) => {
      if (menuRef.current?.contains(e.target)) return;
      setMenuBoardId(null);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setMenuBoardId(null);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuBoardId]);

  const showNotice = (text) => {
    setNotice(text);
    window.setTimeout(() => setNotice(""), 2800);
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = {};
      if (debouncedSearch) params.search = debouncedSearch;
      if (groupFilter) params.group = groupFilter;
      if (studentFilter) params.student = studentFilter;
      const data = await fetchInteractiveBoards(params);
      setItems(normalizeCabinetList(data));
    } catch (err) {
      setError(err?.message || "Не удалось загрузить доски");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, groupFilter, studentFilter]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    Promise.all([
      fetchGroups().catch(() => []),
      fetchStudents().catch(() => []),
    ]).then(([g, s]) => {
      setGroups(normalizeCabinetList(g));
      setStudents(normalizeCabinetList(s));
    });
  }, []);

  const filteredHint = useMemo(() => {
    if (loading) return "";
    if (items.length === 0 && (search || groupFilter || studentFilter)) {
      return "По фильтру ничего не найдено";
    }
    return "";
  }, [items.length, loading, search, groupFilter, studentFilter]);

  const openBoard = (board) => {
    setMenuBoardId(null);
    navigate(`/cabinet/boards/${board.id}`);
  };

  const openRename = (board) => {
    setMenuBoardId(null);
    setRenameBoard(board);
    setRenameTitle(board.title || "Новая доска");
    setRenameError("");
    setRenameSaving(false);
  };

  const closeRename = () => {
    if (renameSaving) return;
    setRenameBoard(null);
    setRenameTitle("");
    setRenameError("");
  };

  const confirmRename = async (e) => {
    e?.preventDefault?.();
    if (!renameBoard) return;
    const title = renameTitle.trim();
    if (!title) {
      setRenameError("Укажите название");
      return;
    }
    setRenameSaving(true);
    setRenameError("");
    try {
      await updateInteractiveBoard(renameBoard.id, { title });
      setRenameBoard(null);
      setRenameTitle("");
      showNotice("Название обновлено");
      await refresh();
    } catch (err) {
      setRenameError(err?.message || "Не удалось переименовать");
    } finally {
      setRenameSaving(false);
    }
  };

  const handleDuplicate = async (board) => {
    setMenuBoardId(null);
    try {
      const copy = await duplicateInteractiveBoard(board.id);
      showNotice("Копия создана");
      navigate(`/cabinet/boards/${copy.id}`);
    } catch (err) {
      showNotice(err?.message || "Не удалось создать копию");
    }
  };

  const confirmDelete = async () => {
    if (!deleteBoard) return;
    setDeleteLoading(true);
    try {
      await deleteInteractiveBoard(deleteBoard.id);
      setDeleteBoard(null);
      showNotice("Доска удалена");
      await refresh();
    } catch (err) {
      showNotice(err?.message || "Не удалось удалить");
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <CabinetPageShell className="cb-boards-page">
      {toast}
      {notice ? <div className="cb-soon-toast" role="status">{notice}</div> : null}

      <CabinetPageHeader
        title="Интерактивные доски"
        subtitle="Рисуйте схемы и объяснения на уроке. Доски сохраняются в кабинете и могут быть привязаны к уроку или ученику."
        actions={[
          {
            label: "Создать доску",
            primary: true,
            icon: "plus",
            onClick: () => setShowCreate(true),
          },
        ]}
      />

      <div className="cb-boards-toolbar">
        <input
          className="cb-boards-toolbar__search"
          type="search"
          placeholder="Поиск по названию"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Поиск по названию"
        />
        <select
          className="cb-boards-toolbar__select"
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value)}
          aria-label="Фильтр по группе"
        >
          <option value="">Все группы</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.title}</option>
          ))}
        </select>
        <select
          className="cb-boards-toolbar__select"
          value={studentFilter}
          onChange={(e) => setStudentFilter(e.target.value)}
          aria-label="Фильтр по ученику"
        >
          <option value="">Все ученики</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {[s.first_name, s.last_name].filter(Boolean).join(" ") || s.full_name || `#${s.id}`}
            </option>
          ))}
        </select>
      </div>

      {error ? <p className="cb-board-form__error" role="alert">{error}</p> : null}
      {filteredHint ? <p className="cabinet-auth-muted">{filteredHint}</p> : null}

      {loading ? (
        <div className="cb-boards-grid" aria-busy="true" aria-label="Загрузка досок">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="cb-boards-skeleton__card" />
          ))}
        </div>
      ) : items.length === 0 && !search && !groupFilter && !studentFilter ? (
        <div className="cb-boards-empty">
          <h2 className="cb-boards-empty__title">Пока нет досок</h2>
          <p className="cb-boards-empty__text">
            Создайте первую интерактивную доску для объяснений на уроке или совместной работы с учеником.
          </p>
          <button type="button" className="cb-btn cb-btn--primary" onClick={() => setShowCreate(true)}>
            Создать доску
          </button>
        </div>
      ) : (
        <div className="cb-boards-grid">
          {items.map((board) => {
            const viewOnly = board.permission === "view" || board.can_edit === false;
            const menuOpen = menuBoardId === board.id;
            return (
              <article key={board.id} className={`cb-board-card${menuOpen ? " is-menu-open" : ""}`}>
                <button
                  type="button"
                  className="cb-board-card__preview"
                  onClick={() => openBoard(board)}
                  aria-label={`Открыть доску «${board.title || "Без названия"}»`}
                >
                  {board.thumbnail ? (
                    <img
                      className="cb-board-card__thumb"
                      src={board.thumbnail}
                      alt=""
                      decoding="async"
                    />
                  ) : (
                    <span className="cb-board-card__thumb-placeholder" aria-hidden="true" />
                  )}
                  {viewOnly ? (
                    <span className="cb-board-card__badge">
                      Только просмотр
                      <span className="cb-board-card__badge-icon" aria-hidden="true">↗</span>
                    </span>
                  ) : null}
                </button>

                <div className="cb-board-card__body">
                  <div className="cb-board-card__title-row">
                    <button
                      type="button"
                      className="cb-board-card__title"
                      onClick={() => openBoard(board)}
                    >
                      {board.title || "Без названия"}
                    </button>
                    <div
                      className="cb-board-card__menu"
                      ref={menuOpen ? menuRef : undefined}
                    >
                      <button
                        type="button"
                        className="cb-board-card__menu-btn"
                        aria-label="Действия с доской"
                        aria-expanded={menuOpen}
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuBoardId(menuOpen ? null : board.id);
                        }}
                      >
                        <span aria-hidden="true">⋯</span>
                      </button>
                      {menuOpen ? (
                        <div className="cb-board-card__menu-panel" role="menu">
                          <button type="button" role="menuitem" onClick={() => openBoard(board)}>
                            Открыть
                          </button>
                          {board.permission === "owner" ? (
                            <button type="button" role="menuitem" onClick={() => openRename(board)}>
                              Переименовать
                            </button>
                          ) : null}
                          <button type="button" role="menuitem" onClick={() => handleDuplicate(board)}>
                            Создать копию
                          </button>
                          {board.permission === "owner" ? (
                            <button
                              type="button"
                              role="menuitem"
                              className="cb-board-card__menu-danger"
                              onClick={() => {
                                setMenuBoardId(null);
                                setDeleteBoard(board);
                              }}
                            >
                              Удалить
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <p className="cb-board-card__meta">
                    <span className="cb-board-card__mark" aria-hidden="true" />
                    <span className="cb-board-card__meta-text">
                      {boardWorkspaceLabel(board)}
                      <span className="cb-board-card__dot"> · </span>
                      Изменено {formatRelativeUpdated(board.updated_at)}
                    </span>
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {showCreate ? (
        <BoardCreateModal
          onClose={() => setShowCreate(false)}
          onCreated={(board) => {
            setShowCreate(false);
            navigate(`/cabinet/boards/${board.id}`);
          }}
        />
      ) : null}

      {renameBoard ? (
        <CabinetModal
          title="Переименовать доску"
          onClose={closeRename}
          footer={(
            <>
              <button
                type="button"
                className="cb-btn cb-btn--secondary"
                onClick={closeRename}
                disabled={renameSaving}
              >
                Отмена
              </button>
              <button
                type="button"
                className="cb-btn cb-btn--primary"
                onClick={confirmRename}
                disabled={renameSaving}
              >
                {renameSaving ? "Сохранение…" : "Сохранить"}
              </button>
            </>
          )}
        >
          <form className="cb-modal-form" onSubmit={confirmRename}>
            {renameError ? <p className="cb-modal-form__error" role="alert">{renameError}</p> : null}
            <label className="cb-field">
              <span>Название</span>
              <input
                value={renameTitle}
                onChange={(e) => {
                  setRenameTitle(e.target.value);
                  setRenameError("");
                }}
                autoFocus
                disabled={renameSaving}
              />
            </label>
          </form>
        </CabinetModal>
      ) : null}

      <ConfirmActionModal
        open={Boolean(deleteBoard)}
        title="Удалить доску?"
        text={`Удалить доску «${deleteBoard?.title || "Без названия"}»?`}
        confirmLabel="Удалить"
        danger
        loading={deleteLoading}
        onClose={() => {
          if (!deleteLoading) setDeleteBoard(null);
        }}
        onConfirm={confirmDelete}
      />
    </CabinetPageShell>
  );
}
