import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
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
    return d.toLocaleString("ru-RU", {
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function formatMoney(rawAmount, currency = "") {
  const normalized = String(rawAmount ?? "").replace(/\s/g, "").replace(",", ".");
  const num = Number(normalized);
  const cur = String(currency || "").trim().toUpperCase();
  if (!Number.isFinite(num)) {
    const fallback = [rawAmount, currency].filter(Boolean).join(" ").trim();
    return fallback || null;
  }
  const amount = new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: Number.isInteger(num) ? 0 : 2,
  }).format(num);
  if (!cur || cur === "RUB" || cur === "RUR" || cur === "₽") {
    return `${amount} ₽`;
  }
  return `${amount} ${currency}`.trim();
}

function notificationHref(n, studentMode) {
  const raw = n?.url || n?.payload?.url || n?.payload?.link || "";
  if (typeof raw === "string" && raw.startsWith("/")) return raw;
  if (studentMode) return "/cabinet/student/lessons";
  return "/cabinet/schedule";
}

function notificationIcon(n) {
  const type = String(n?.payload?.type || n?.payload?.event_type || "").toLowerCase();
  if (type.includes("billing") || type.includes("payment") || type.includes("debt") || type.includes("package")) {
    return "wallet";
  }
  if (type.includes("homework") || type.includes("review") || type.includes("assignment")) {
    return "check";
  }
  if (type.includes("lesson") || type.includes("schedule") || type.includes("calendar")) {
    return "calendar";
  }
  if (type.includes("journal")) return "note";
  if (type.includes("student")) return "students";
  return "bell";
}

function parseNotificationContent(n) {
  const payload = n?.payload || {};
  const type = String(payload.type || payload.event_type || "").toLowerCase();
  const message = String(n?.message || "").trim();
  const lines = message.split(/\n+/).map((line) => line.trim()).filter(Boolean);

  const studentFromPayload = payload.student_name || payload.studentName || "";
  const amountFromPayload = payload.amount ?? payload.sum ?? null;
  const currencyFromPayload = payload.currency || "";

  let studentName = studentFromPayload || "";
  let amountLabel = amountFromPayload != null
    ? formatMoney(amountFromPayload, currencyFromPayload)
    : null;

  for (const line of lines) {
    const studentMatch = line.match(/^Ученик:\s*(.+)$/i);
    if (studentMatch && !studentName) {
      studentName = studentMatch[1].trim();
      continue;
    }
    const amountMatch = line.match(/^Сумма:\s*([\d\s.,]+)\s*([A-Za-zА-Яа-я₽€$]*)\s*$/i);
    if (amountMatch && !amountLabel) {
      amountLabel = formatMoney(amountMatch[1], amountMatch[2]);
    }
  }

  // Fallback: single-line "Ученик: … Сумма: …"
  if (!studentName || !amountLabel) {
    const compact = message.match(
      /Ученик:\s*(.+?)\s+Сумма:\s*([\d\s.,]+)\s*([A-Za-zА-Яа-я₽€$]*)/i,
    );
    if (compact) {
      if (!studentName) studentName = compact[1].trim();
      if (!amountLabel) amountLabel = formatMoney(compact[2], compact[3]);
    }
  }

  const isPayment = type.includes("billing")
    || type.includes("payment")
    || Boolean(amountLabel)
    || /поступила оплата/i.test(String(n?.title || ""));

  if (isPayment) {
    return {
      kind: "payment",
      studentName: studentName || null,
      amountLabel,
      extraLines: lines.filter((line) => !/^Ученик:/i.test(line) && !/^Сумма:/i.test(line)),
    };
  }

  return {
    kind: "default",
    lines,
  };
}

export default function CabinetNotificationsBell({ studentMode = false }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const rootRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
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
      setError("Не удалось загрузить уведомления");
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
        aria-expanded={open}
      >
        <CabinetIcon name="bell" />
        {unread > 0 ? <span className="cabinet-notifications__badge">{unread > 9 ? "9+" : unread}</span> : null}
      </button>

      {open ? (
        <div className="cabinet-notifications__panel" role="dialog" aria-label="Уведомления">
          <div className="cabinet-notifications__head">
            <h2 className="cabinet-notifications__title-head">Уведомления</h2>
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
              {items.length > 0 ? (
                <button
                  type="button"
                  className="cabinet-notifications__clear"
                  onClick={handleClear}
                  disabled={Boolean(busy)}
                >
                  {busy === "clear" ? "…" : "Очистить"}
                </button>
              ) : null}
            </div>
          </div>

          <div className="cabinet-notifications__body">
            {loading ? (
              <div className="cabinet-notifications__skeleton" aria-hidden="true">
                <div className="cabinet-notifications__skeleton-row" />
                <div className="cabinet-notifications__skeleton-row" />
                <div className="cabinet-notifications__skeleton-row" />
              </div>
            ) : null}

            {!loading && error ? (
              <div className="cabinet-notifications__state">
                <p className="cabinet-notifications__state-title">{error}</p>
                <button
                  type="button"
                  className="cabinet-notifications__retry"
                  onClick={() => void load()}
                >
                  Повторить
                </button>
              </div>
            ) : null}

            {!loading && !error && items.length === 0 ? (
              <div className="cabinet-notifications__state">
                <span className="cabinet-notifications__state-icon" aria-hidden="true">
                  <CabinetIcon name="bell" />
                </span>
                <p className="cabinet-notifications__state-title">Новых уведомлений нет</p>
                <p className="cabinet-notifications__state-text">
                  Здесь появятся сообщения о занятиях, работах и оплатах.
                </p>
              </div>
            ) : null}

            {!loading && !error && items.length > 0 ? (
              <ul className="cabinet-notifications__list">
                {items.map((n) => {
                  const content = parseNotificationContent(n);
                  const icon = notificationIcon(n);
                  const unreadItem = !n.is_read;
                  const aria = [
                    n.title,
                    content.kind === "payment"
                      ? [content.studentName, content.amountLabel].filter(Boolean).join(", ")
                      : content.lines.join(". "),
                    formatWhen(n.created_at),
                  ].filter(Boolean).join(". ");

                  return (
                    <li
                      key={n.id}
                      className={`cabinet-notifications__li${unreadItem ? " is-unread" : ""}`}
                    >
                      <button
                        type="button"
                        className="cabinet-notifications__item"
                        onClick={() => void handleOpenItem(n)}
                        aria-label={aria}
                      >
                        <span className={`cabinet-notifications__icon cabinet-notifications__icon--${icon}`} aria-hidden="true">
                          <CabinetIcon name={icon} />
                          {unreadItem ? <span className="cabinet-notifications__dot" /> : null}
                        </span>

                        <span className="cabinet-notifications__content">
                          <span className="cabinet-notifications__title">{n.title}</span>

                          {content.kind === "payment" ? (
                            <>
                              {content.studentName ? (
                                <span className="cabinet-notifications__person">{content.studentName}</span>
                              ) : null}
                              {content.amountLabel ? (
                                <span className="cabinet-notifications__amount">{content.amountLabel}</span>
                              ) : null}
                              {content.extraLines.map((line) => (
                                <span key={line} className="cabinet-notifications__line">{line}</span>
                              ))}
                            </>
                          ) : (
                            content.lines.map((line) => (
                              <span key={line} className="cabinet-notifications__line">{line}</span>
                            ))
                          )}

                          <span className="cabinet-notifications__time">{formatWhen(n.created_at)}</span>
                        </span>

                        <span className="cabinet-notifications__chevron" aria-hidden="true">
                          <CabinetIcon name="arrow" />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
