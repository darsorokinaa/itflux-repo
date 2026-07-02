import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import CabinetIcon from "../CabinetIcons";
import {
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

export default function CabinetNotificationsBell({ studentMode = false }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
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

  const handleRead = async (id) => {
    await markNotificationRead(id, { student: studentMode });
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    setUnread((c) => Math.max(0, c - 1));
  };

  const handleReadAll = async () => {
    await markAllNotificationsRead({ student: studentMode });
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnread(0);
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
            {unread > 0 ? (
              <button type="button" className="cabinet-notifications__read-all" onClick={handleReadAll}>
                Прочитать все
              </button>
            ) : null}
          </div>
          {loading ? <p className="cabinet-notifications__empty">Загрузка…</p> : null}
          {!loading && items.length === 0 ? (
            <p className="cabinet-notifications__empty">Нет уведомлений</p>
          ) : null}
          <ul className="cabinet-notifications__list">
            {items.map((n) => (
              <li key={n.id} className={n.is_read ? "" : "cabinet-notifications__item--unread"}>
                <button type="button" className="cabinet-notifications__item" onClick={() => !n.is_read && handleRead(n.id)}>
                  <span className="cabinet-notifications__title">{n.title}</span>
                  <span className="cabinet-notifications__message">{n.message}</span>
                  <span className="cabinet-notifications__time">{formatWhen(n.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
          <Link
            to={studentMode ? "/cabinet/student/schedule" : "/cabinet/schedule"}
            className="cabinet-notifications__footer"
            onClick={() => setOpen(false)}
          >
            Расписание
          </Link>
        </div>
      ) : null}
    </div>
  );
}
