import { useEffect, useMemo, useRef, useState } from "react";
import CabinetModal from "./CabinetModal";
import {
  cancelEventFinance,
  finalizeEventBilling,
  previewEventBilling,
} from "../../utils/cabinetAuth";

const FINAL_STATUSES = new Set([
  "paid",
  "paid_from_package",
  "awaiting_payment",
  "partially_paid",
  "not_billable",
]);

/**
 * Короткий вопрос по финансам урока.
 * mode: conducted | cancelled | rescheduled | no_show
 */
export default function FinalizeLessonBillingModal({
  open,
  onClose,
  eventId,
  mode = "conducted",
  cancelledBy = "student",
  onDone,
  onRequestPayment,
}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [alreadyDone, setAlreadyDone] = useState(false);
  const silentSkipDoneRef = useRef(false);

  useEffect(() => {
    if (!open || !eventId) return undefined;
    let cancelled = false;
    silentSkipDoneRef.current = false;
    setLoading(true);
    setError("");
    setAlreadyDone(false);
    previewEventBilling(eventId)
      .then((data) => {
        if (cancelled) return;
        const rows = data?.items || [];
        setItems(rows);
        const allFinal = rows.length > 0 && rows.every((r) => FINAL_STATUSES.has(r.financial_status));
        setAlreadyDone(allFinal);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Не удалось загрузить расчёт");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, eventId]);

  const hasPackage = useMemo(
    () => items.some((row) => Boolean(row.package)),
    [items],
  );
  const first = items[0];

  // Проведённый урок: автосписание с абонемента или автопометка «ожидает оплаты».
  useEffect(() => {
    if (!open || loading || error || alreadyDone) return;
    if (mode !== "conducted") return;
    if (silentSkipDoneRef.current) return;
    if (!items.length) return;
    silentSkipDoneRef.current = true;

    let cancelled = false;
    setBusy(true);
    const run = async () => {
      try {
        const action = hasPackage ? "package" : "charge";
        const result = await finalizeEventBilling(eventId, {
          delivery_status: "conducted",
          financial_action: action,
          idempotency_key: `ui-auto-${action}-${eventId}`,
        });
        if (!cancelled) {
          onDone?.({ items: result?.items || [], silent: true, auto: true, action });
          onClose?.();
        }
      } catch (err) {
        if (!cancelled) {
          if (err?.code === "ALREADY_FINALIZED"
            || String(err?.message || "").includes("уже оформлен")) {
            onDone?.({ silent: true });
            onClose?.();
          } else {
            // Нет тарифа / цены — оставим модалку с ошибкой и ручным выбором.
            silentSkipDoneRef.current = false;
            setError(err.message || "Не удалось оформить автоматически");
          }
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [
    open,
    loading,
    error,
    alreadyDone,
    mode,
    hasPackage,
    items.length,
    eventId,
    onDone,
    onClose,
  ]);

  // Без абонемента на отмене — тихо skip и закрыть.
  // Перенос (rescheduled): всегда без списания — урок ещё состоится.
  // Отмена: никогда не списываем занятие.
  useEffect(() => {
    if (!open || loading || error || alreadyDone) return;
    if (mode !== "cancelled" && mode !== "rescheduled") return;
    if (silentSkipDoneRef.current) return;
    silentSkipDoneRef.current = true;

    if (!items.length) {
      onDone?.({ silent: true });
      onClose?.();
      return;
    }

    let cancelled = false;
    setBusy(true);
    const run = async () => {
      try {
        if (mode === "cancelled") {
          await cancelEventFinance(eventId, {
            cancelled_by: cancelledBy,
            financial_action: "skip",
            idempotency_key: `ui-skip-${eventId}`,
          });
        } else {
          await finalizeEventBilling(eventId, {
            delivery_status: "rescheduled",
            financial_action: "skip",
            idempotency_key: `ui-skip-reschedule-${eventId}`,
          });
        }
        if (!cancelled) {
          onDone?.({ silent: true });
          onClose?.();
        }
      } catch (err) {
        if (!cancelled) {
          if (err?.code === "ALREADY_FINALIZED"
            || String(err?.message || "").includes("уже оформлен")) {
            onDone?.({ silent: true });
            onClose?.();
          } else {
            silentSkipDoneRef.current = false;
            setError(err.message || "Не удалось оформить");
          }
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [
    open,
    loading,
    error,
    alreadyDone,
    mode,
    items.length,
    eventId,
    cancelledBy,
    onDone,
    onClose,
  ]);

  if (!open) return null;

  const title = mode === "conducted"
    ? "Урок окончен"
    : mode === "rescheduled"
      ? "Занятие перенесено"
      : mode === "no_show"
        ? "Ученик не пришёл"
        : "Занятие отменено";

  const submitFinalize = async (financialAction, { openPayment = false, deliveryStatus } = {}) => {
    setBusy(true);
    setError("");
    try {
      let result;
      if (mode === "cancelled") {
        result = await cancelEventFinance(eventId, {
          cancelled_by: cancelledBy,
          financial_action: financialAction,
          idempotency_key: `ui-${mode}-${financialAction}-${eventId}-${Date.now()}`,
        });
      } else {
        result = await finalizeEventBilling(eventId, {
          delivery_status: deliveryStatus
            || (mode === "rescheduled" ? "rescheduled" : mode === "no_show" ? "no_show" : "conducted"),
          financial_action: financialAction,
          idempotency_key: `ui-${mode}-${financialAction}-${eventId}-${Date.now()}`,
        });
      }
      const rows = result?.items || [];
      onDone?.({ items: rows });
      if (openPayment) {
        const payable = rows.filter((r) =>
          ["awaiting_payment", "partially_paid"].includes(r.financial_status),
        );
        const studentId = payable[0]?.student_id || first?.student_id;
        const amount = payable.reduce(
          (sum, r) => sum + Math.max(0, Number(r.charged_amount || 0) - Number(r.paid_amount || 0)),
          0,
        );
        onRequestPayment?.({
          studentId,
          eventBillingIds: payable.map((r) => r.id),
          amount: amount || Number(first?.amount || 0),
          currency: payable[0]?.currency || first?.currency,
          eventId,
        });
      }
      onClose?.();
    } catch (err) {
      setError(err.message || "Не удалось оформить");
    } finally {
      setBusy(false);
    }
  };

  if (alreadyDone) {
    return (
      <CabinetModal onClose={onClose} title={title}>
        <div className="pay-modal-form">
          <p className="pay-hint">Финансы этого урока уже оформлены.</p>
          <div className="pay-actions">
            <button type="button" className="pay-btn pay-btn--primary" onClick={onClose}>
              Закрыть
            </button>
          </div>
        </div>
      </CabinetModal>
    );
  }

  if (loading || (busy && mode === "conducted" && !error) || (busy && mode === "rescheduled") || (busy && mode === "cancelled")) {
    return (
      <CabinetModal onClose={onClose} title={title}>
        <div className="pay-modal-form">
          {error ? <div className="pay-error">{error}</div> : null}
          <p className="pay-hint">
            {mode === "conducted" ? "Списываем занятие…" : "Сохранение…"}
          </p>
        </div>
      </CabinetModal>
    );
  }

  // Ученик не пришёл: простой выбор.
  if (mode === "no_show") {
    return (
      <CabinetModal onClose={onClose} title={title}>
        <div className="pay-modal-form">
          {error ? <div className="pay-error">{error}</div> : null}
          <p className="pay-hint">Списать занятие из абонемента или оставить без списания?</p>
          <div className="pay-actions">
            <button
              type="button"
              className="pay-btn"
              disabled={busy}
              onClick={() => void submitFinalize("skip")}
            >
              Не списывать
            </button>
            <button
              type="button"
              className="pay-btn pay-btn--primary"
              disabled={busy}
              onClick={() => void submitFinalize(hasPackage ? "package" : "charge")}
            >
              {busy ? "Сохранение…" : "Списать занятие"}
            </button>
          </div>
        </div>
      </CabinetModal>
    );
  }

  // Fallback: ошибка автосписания — предложить повтор.
  if (mode === "conducted") {
    return (
      <CabinetModal onClose={onClose} title={title} wide>
        <div className="pay-modal-form">
          {error ? <div className="pay-error">{error}</div> : null}
          <p className="pay-hint">
            {hasPackage
              ? "Не удалось списать автоматически. Списать занятие из абонемента?"
              : "Не удалось оформить автоматически. Отметить урок как неоплаченный?"}
          </p>
          <div className="pay-actions">
            <button type="button" className="pay-btn" disabled={busy} onClick={onClose}>
              Позже
            </button>
            <button
              type="button"
              className="pay-btn pay-btn--primary"
              disabled={busy}
              onClick={() => void submitFinalize(hasPackage ? "package" : "charge")}
            >
              {busy ? "Сохранение…" : (hasPackage ? "Списать" : "Отметить неоплаченным")}
            </button>
          </div>
        </div>
      </CabinetModal>
    );
  }

  return (
    <CabinetModal onClose={onClose} title={title}>
      <div className="pay-modal-form">
        {error ? <div className="pay-error">{error}</div> : null}
        <p className="pay-hint">Оформление…</p>
      </div>
    </CabinetModal>
  );
}
