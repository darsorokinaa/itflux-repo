import { useEffect, useMemo, useState } from "react";
import {
  chargeAccountFromPackage,
  markEventBillingPaid,
  previewAccountChargeFromPackage,
} from "../../utils/cabinetAuth";
import { formatLessonWhen, formatMoney, formatUnits } from "../billing/billingFormat";

/**
 * Модалка: списать неоплаченные уроки из абонемента (в т.ч. задним числом).
 */
export default function ChargeFromPackageModal({
  open,
  account,
  initialLessonIds = null,
  onClose,
  onDone,
}) {
  const unpaid = account?.unpaid_lessons || [];
  const packages = account?.available_packages || [];
  const currency = account?.currency || "RUB";

  const [selectedIds, setSelectedIds] = useState([]);
  const [packageId, setPackageId] = useState("");
  const [comment, setComment] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [markPaidId, setMarkPaidId] = useState(null);
  const [markAmount, setMarkAmount] = useState("");
  const [markMethod, setMarkMethod] = useState("transfer");
  const [markComment, setMarkComment] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setPreview(null);
    setComment("");
    setMarkPaidId(null);
    const pkgs = account?.available_packages || [];
    setPackageId(pkgs[0]?.id || "");
    if (initialLessonIds?.length) {
      setSelectedIds(initialLessonIds.map(String));
    } else {
      setSelectedIds((account?.unpaid_lessons || []).map((l) => String(l.id)));
    }
  }, [open, account?.id, initialLessonIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedPackage = useMemo(
    () => packages.find((p) => String(p.id) === String(packageId)),
    [packages, packageId],
  );

  const selectedLessons = useMemo(
    () => unpaid.filter((l) => selectedIds.includes(String(l.id))),
    [unpaid, selectedIds],
  );

  const hasBeforePaymentWarning = useMemo(() => {
    if (preview?.items?.some((i) => i.before_package_payment)) return true;
    return false;
  }, [preview]);

  if (!open || !account) return null;

  const toggle = (id) => {
    const sid = String(id);
    setSelectedIds((prev) => (
      prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid]
    ));
    setPreview(null);
  };

  const selectEarliest = async () => {
    if (!packageId || !account?.id) return;
    setBusy(true);
    setError("");
    try {
      const data = await previewAccountChargeFromPackage(account.id, {
        package_id: packageId,
        select_earliest: true,
      });
      setPreview(data);
      setSelectedIds((data.items || []).map((i) => String(i.event_billing_id)));
    } catch (err) {
      setError(err.message || "Не удалось подобрать уроки");
    } finally {
      setBusy(false);
    }
  };

  const runPreview = async () => {
    if (!packageId || !selectedIds.length) {
      setError("Выберите абонемент и хотя бы один урок");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await previewAccountChargeFromPackage(account.id, {
        package_id: packageId,
        event_billing_ids: selectedIds,
      });
      setPreview(data);
    } catch (err) {
      setError(err.message || "Не удалось рассчитать списание");
    } finally {
      setBusy(false);
    }
  };

  const confirmCharge = async () => {
    if (!packageId || !selectedIds.length) {
      setError("Выберите абонемент и уроки");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (!preview) {
        const data = await previewAccountChargeFromPackage(account.id, {
          package_id: packageId,
          event_billing_ids: selectedIds,
        });
        setPreview(data);
        setBusy(false);
        return;
      }
      const result = await chargeAccountFromPackage(account.id, {
        package_id: packageId,
        event_billing_ids: selectedIds,
        comment,
        idempotency_key: `settle-${account.id}-${packageId}-${selectedIds.slice().sort().join(",")}`,
      });
      onDone?.(result);
      onClose?.();
    } catch (err) {
      setError(err.message || "Не удалось списать уроки");
    } finally {
      setBusy(false);
    }
  };

  const submitMarkPaid = async () => {
    if (!markPaidId) return;
    setBusy(true);
    setError("");
    try {
      const result = await markEventBillingPaid(markPaidId, {
        amount: markAmount || undefined,
        method: markMethod,
        comment: markComment,
      });
      onDone?.({ ...result, message: result.message || "Оплата урока отмечена" });
      setMarkPaidId(null);
      onClose?.();
    } catch (err) {
      setError(err.message || "Не удалось отметить оплату");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pay-history pay-overlay" role="dialog" aria-modal="true" aria-label="Списать из абонемента">
      <button type="button" className="pay-overlay__backdrop" aria-label="Закрыть" onClick={onClose} />
      <div className="pay-overlay__panel pay-overlay__panel--drawer">
        <header className="pay-overlay__head">
          <div>
            <h2>Списать из абонемента</h2>
            <p className="pay-hint">{account.student_name}</p>
          </div>
          <button type="button" className="pay-btn pay-btn--icon" onClick={onClose}>×</button>
        </header>

        <div className="pay-drawer-body">
          {error ? <p className="pay-error">{error}</p> : null}

          {packages.length === 0 ? (
            <p className="pay-hint">Нет абонемента с остатком занятий. Создайте или оплатите абонемент.</p>
          ) : (
            <section className="pay-drawer-section">
              <h3>Абонемент</h3>
              <select
                className="pay-input"
                value={packageId}
                onChange={(e) => {
                  setPackageId(e.target.value);
                  setPreview(null);
                }}
              >
                {packages.map((pkg) => (
                  <option key={pkg.id} value={pkg.id}>
                    {pkg.title}
                    {" — остаток "}
                    {formatUnits(pkg.remaining_units, pkg.unit_type)}
                    {pkg.is_paid === false ? " · ожидает оплаты" : ""}
                  </option>
                ))}
              </select>
              {selectedPackage ? (
                <p className="pay-hint" style={{ marginTop: 8 }}>
                  Остаток: {formatUnits(selectedPackage.remaining_units, selectedPackage.unit_type)}
                  {selectedPackage.expires_at ? ` · до ${selectedPackage.expires_at.slice(0, 10)}` : ""}
                </p>
              ) : null}
            </section>
          )}

          <section className="pay-drawer-section">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Неоплаченные уроки</h3>
              <button
                type="button"
                className="pay-btn pay-btn--ghost"
                disabled={busy || !packageId}
                onClick={selectEarliest}
              >
                Выбрать наиболее ранние
              </button>
            </div>
            {unpaid.length === 0 ? (
              <p className="pay-hint">Неоплаченных уроков нет</p>
            ) : (
              <ul className="pay-unpaid-list pay-unpaid-list--selectable">
                {unpaid.map((lesson) => {
                  const id = String(lesson.id);
                  const checked = selectedIds.includes(id);
                  const due = Number(lesson.due_amount || 0);
                  return (
                    <li key={id}>
                      <label className="pay-unpaid-check">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(id)}
                        />
                        <div>
                          <strong>{formatLessonWhen(lesson.event_starts_at)}</strong>
                          <span>
                            {lesson.event_title || "Урок"}
                            {" · "}
                            {lesson.duration_minutes || 60}
                            {" мин"}
                          </span>
                          {lesson.unpaid_reason ? (
                            <span className="pay-hint">{lesson.unpaid_reason}</span>
                          ) : null}
                        </div>
                      </label>
                      <div className="pay-unpaid-list__right">
                        {due > 0 ? (
                          <span className="pay-balance pay-balance--debt">
                            −{formatMoney(due, currency).replace(/^-/, "")}
                          </span>
                        ) : (
                          <span className="pay-balance pay-balance--muted">—</span>
                        )}
                        <button
                          type="button"
                          className="pay-btn pay-btn--ghost"
                          onClick={() => {
                            setMarkPaidId(id);
                            setMarkAmount(due > 0 ? String(due) : "");
                            setMarkComment("");
                          }}
                        >
                          Оплатить отдельно
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="pay-drawer-section">
            <h3>Комментарий</h3>
            <textarea
              className="pay-input"
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Необязательно"
            />
          </section>

          {preview ? (
            <section className="pay-drawer-section">
              <p className="pay-confirm-box">
                {preview.message || `Будет списано: ${preview.lessons_count} занятий. Остаток после списания: ${preview.remaining_after}.`}
              </p>
              {hasBeforePaymentWarning ? (
                <p className="pay-warn-box">
                  Этот урок прошёл до даты оплаты абонемента. Списание будет использовано для погашения задолженности.
                </p>
              ) : null}
            </section>
          ) : null}

          {markPaidId ? (
            <section className="pay-drawer-section">
              <h3>Отметить оплаченным отдельно</h3>
              <div className="pay-form-grid">
                <label>
                  Сумма
                  <input
                    className="pay-input"
                    value={markAmount}
                    onChange={(e) => setMarkAmount(e.target.value)}
                    inputMode="decimal"
                  />
                </label>
                <label>
                  Способ
                  <select
                    className="pay-input"
                    value={markMethod}
                    onChange={(e) => setMarkMethod(e.target.value)}
                  >
                    <option value="transfer">Перевод</option>
                    <option value="cash">Наличные</option>
                    <option value="card">Карта</option>
                    <option value="sbp">СБП</option>
                    <option value="other">Другое</option>
                  </select>
                </label>
              </div>
              <textarea
                className="pay-input"
                rows={2}
                value={markComment}
                onChange={(e) => setMarkComment(e.target.value)}
                placeholder="Комментарий"
                style={{ marginTop: 8 }}
              />
              <div className="pay-drawer-actions" style={{ marginTop: 8 }}>
                <button type="button" className="pay-btn pay-btn--primary" disabled={busy} onClick={submitMarkPaid}>
                  Сохранить оплату
                </button>
                <button type="button" className="pay-btn" onClick={() => setMarkPaidId(null)}>
                  Отмена
                </button>
              </div>
            </section>
          ) : null}

          <div className="pay-drawer-actions">
            <button
              type="button"
              className="pay-btn"
              disabled={busy || !selectedIds.length || !packageId}
              onClick={runPreview}
            >
              Рассчитать
            </button>
            <button
              type="button"
              className="pay-btn pay-btn--primary"
              disabled={busy || !selectedIds.length || !packageId || packages.length === 0}
              onClick={confirmCharge}
            >
              {preview
                ? `Подтвердить списание (${selectedLessons.length})`
                : "Списать из абонемента"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
