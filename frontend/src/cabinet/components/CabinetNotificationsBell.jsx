import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import CabinetIcon from "../CabinetIcons";
import {
  clearNotifications,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../../utils/cabinetAuth";

function formatWhen(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function notificationHref(n, studentMode) {
  const raw = n?.url || n?.payload?.url || n?.payload?.link || "";
  if (typeof raw === "string" && raw.startsWith("/")) return raw;
  if (studentMode) return "/cabinet/student/lessons";
  return "/cabinet/schedule";
}

export default function CabinetNotificationsBell({ studentMode = false }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const rootRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchNotifications({ student: studentMode });
      const raw = data?.items || data?.results || [];
      const seen = new Set();
      const deduped = raw.filter((n) => {
        const key = `${n.id ?? ""}|${n.title}|${n.message}|${(n.created_at || "").slice(0, 16)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setItems(deduped);
      setUnread(data?.unread_count ?? data?.count ?? 0);
    } catch {
      setItems([]);
      setUnread(0);
    } finally {
      setLoading(false);
    }
  }, [studentMode]);

  useEffect(() => {
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    const openNotifications = () => {
      setOpen(true);
      load();
    };
    window.addEventListener("cabinet:open-notifications", openNotifications);
    return () => window.removeEventListener("cabinet:open-notifications", openNotifications);
  }, [load]);

  const handleOpenItem = async (n) => {
    if (!n.is_read) {
      try {
        await markNotificationRead(n.id, { student: studentMode });
        setItems((prev) => prev.map((row) => (row.id === n.id ? { ...row, is_read: true } : row)));
        setUnread((c) => Math.max(0, c - 1));
      } catch {
        /* ignore */
      }
    }
    setOpen(false);
    navigate(notificationHref(n, studentMode));
  };

  const handleReadAll = async () => {
    if (!unread || busy) return;
    setBusy("read");
    try {
      await markAllNotificationsRead({ student: studentMode });
      setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnread(0);
    } finally {
      setBusy("");
    }
  };

  const handleClear = async () => {
    if (!items.length || busy) return;
    setBusy("clear");
    try {
      await clearNotifications({ student: studentMode });
      setItems([]);
      setUnread(0);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="cabinet-notifications" ref={rootRef}>
      <button
        type="button"
        className="cabinet-notifications__btn"
        onClick={() => setOpen((v) => !v)}
        aria-label="Уведомления"
      >
        <CabinetIcon name="bell" />
        {unread > 0 ? <span className="cabinet-notifications__badge">{unread > 9 ? "9+" : unread}</span> : null}
      </button>
      {open ? (
        <div className="cabinet-notifications__panel">
          <div className="cabinet-notifications__head">
            <strong>Уведомления</strong>
            {items.length > 0 ? (
              <div className="cabinet-notifications__actions">
                {unread > 0 ? (
                  <button
                    type="button"
                    className="cabinet-notifications__read-all"
                    onClick={handleReadAll}
                    disabled={Boolean(busy)}
                  >
                    {busy === "read" ? "…" : "Прочитать все"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="cabinet-notifications__clear"
                  onClick={handleClear}
                  disabled={Boolean(busy)}
                >
                  {busy === "clear" ? "…" : "Очистить"}
                </button>
              </div>
            ) : null}
          </div>
          {loading ? <p className="cabinet-notifications__empty">Загрузка…</p> : null}
          {!loading && items.length === 0 ? (
            <p className="cabinet-notifications__empty">Нет уведомлений</p>
          ) : null}
          <ul className="cabinet-notifications__list">
            {items.map((n) => (
              <li key={n.id} className={n.is_read ? "" : "cabinet-notifications__item--unread"}>
                <button
                  type="button"
                  className="cabinet-notifications__item"
                  onClick={() => void handleOpenItem(n)}
                >
                  <span className="cabinet-notifications__title">{n.title}</span>
                  <span className="cabinet-notifications__message">{n.message}</span>
                  <span className="cabinet-notifications__meta">
                    <span className="cabinet-notifications__time">{formatWhen(n.created_at)}</span>
                    {n.url || n.payload?.url ? (
                      <span className="cabinet-notifications__link-hint">Открыть →</span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Link
            to={studentMode ? "/cabinet/student/lessons" : "/cabinet/schedule"}
            className="cabinet-notifications__footer"
            onClick={() => setOpen(false)}
          >
            {studentMode ? "К занятиям" : "Расписание"}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
