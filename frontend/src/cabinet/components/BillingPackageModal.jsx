import { useEffect, useMemo, useState } from "react";
import CabinetModal from "./CabinetModal";
import { createBillingPackage } from "../../utils/cabinetAuth";
import { formatMoney, formatUnits } from "../billing/billingFormat";
import "../styles/payments.css";

const LESSON_PRESETS = [4, 8, 12];
const DURATION_PRESETS = [45, 60, 90];

export default function BillingPackageModal({
  open,
  onClose,
  students = [],
  defaultStudentId = null,
  onDone,
}) {
  const [studentId, setStudentId] = useState(defaultStudentId || "");
  const [totalUnits, setTotalUnits] = useState("8");
  const [customUnits, setCustomUnits] = useState(false);
  const [duration, setDuration] = useState("60");
  const [customDuration, setCustomDuration] = useState(false);
  const [amount, setAmount] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createdPkg, setCreatedPkg] = useState(null);

  const unitsNum = Number(totalUnits) || 0;
  const amountNum = Number(amount) || 0;
  const perUnit = useMemo(
    () => (unitsNum > 0 && amountNum > 0 ? amountNum / unitsNum : null),
    [unitsNum, amountNum],
  );

  useEffect(() => {
    if (!open) return;
    setStudentId(defaultStudentId || "");
    setTotalUnits("8");
    setCustomUnits(false);
    setDuration("60");
    setCustomDuration(false);
    setAmount("");
    setStartsAt(new Date().toISOString().slice(0, 10));
    setExpiresAt("");
    setError("");
    setCreatedPkg(null);
  }, [open, defaultStudentId]);

  if (!open) return null;

  if (createdPkg) {
    return (
      <CabinetModal onClose={onClose} title="Абонемент создан">
        <div className="pay-modal-form">
          <ul className="pay-drawer-facts">
            <li>
              <span>Всего занятий</span>
              <strong>{formatUnits(createdPkg.total_units, createdPkg.unit_type || "lesson")}</strong>
            </li>
            <li>
              <span>Осталось</span>
              <strong>{formatUnits(createdPkg.remaining_units, createdPkg.unit_type || "lesson")}</strong>
            </li>
            <li>
              <span>Стоимость</span>
              <strong>{formatMoney(createdPkg.purchase_amount)}</strong>
            </li>
            <li>
              <span>Оплачено</span>
              <strong>{formatMoney(createdPkg.paid_amount || 0)}</strong>
            </li>
            <li>
              <span>Статус</span>
              <strong>{createdPkg.display_status_label || "Ожидает оплаты"}</strong>
            </li>
          </ul>
          <div className="pay-actions">
            <button type="button" className="pay-btn pay-btn--primary" onClick={onClose}>
              Готово
            </button>
          </div>
        </div>
      </CabinetModal>
    );
  }

  const submit = async () => {
    if (!studentId) {
      setError("Выберите ученика");
      return;
    }
    if (unitsNum <= 0) {
      setError("Укажите количество занятий");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const durationLabel = duration ? `${duration} мин` : "";
      const autoTitle = `${unitsNum} занятий${durationLabel ? ` · ${formatMoney(amountNum || 0)}` : ""}`.replace(
        / · 0 ₽$/,
        durationLabel ? ` по ${durationLabel}` : "",
      );
      const title = amountNum > 0
        ? `${unitsNum} занятий · ${formatMoney(amountNum)}`
        : `Абонемент на ${unitsNum} занятий${durationLabel ? ` по ${durationLabel}` : ""}`;
      const pkg = await createBillingPackage({
        student_id: Number(studentId),
        title: title || autoTitle,
        unit_type: "lesson",
        total_units: String(unitsNum),
        purchase_amount: amount || "0",
        starts_at: startsAt || null,
        expires_at: expiresAt || null,
        lesson_duration_minutes: duration ? Number(duration) : null,
        auto_use: true,
        await_payment: true,
      });
      setCreatedPkg(pkg);
      onDone?.(pkg);
    } catch (err) {
      setError(err.message || "Не удалось создать абонемент");
    } finally {
      setBusy(false);
    }
  };

  return (
    <CabinetModal onClose={onClose} title="Создать абонемент">
      <div className="pay-modal-form">
        {error ? <div className="pay-error">{error}</div> : null}

        <div className="pay-field">
          <label>Ученик</label>
          <select className="pay-select" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">Выберите ученика</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>{s.name || s.full_name || s.student_name}</option>
            ))}
          </select>
        </div>

        <div className="pay-field">
          <label>Количество занятий</label>
          <div className="pay-chip-row">
            {LESSON_PRESETS.map((n) => (
              <button
                key={n}
                type="button"
                className={`pay-chip${!customUnits && totalUnits === String(n) ? " pay-chip--active" : ""}`}
                onClick={() => { setCustomUnits(false); setTotalUnits(String(n)); }}
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              className={`pay-chip${customUnits ? " pay-chip--active" : ""}`}
              onClick={() => setCustomUnits(true)}
            >
              Другое
            </button>
          </div>
          {customUnits ? (
            <input
              className="pay-input"
              type="number"
              min="1"
              value={totalUnits}
              onChange={(e) => setTotalUnits(e.target.value)}
              style={{ marginTop: 8 }}
            />
          ) : null}
        </div>

        <div className="pay-field">
          <label>Длительность одного занятия</label>
          <div className="pay-chip-row">
            {DURATION_PRESETS.map((n) => (
              <button
                key={n}
                type="button"
                className={`pay-chip${!customDuration && duration === String(n) ? " pay-chip--active" : ""}`}
                onClick={() => { setCustomDuration(false); setDuration(String(n)); }}
              >
                {n} мин
              </button>
            ))}
            <button
              type="button"
              className={`pay-chip${customDuration ? " pay-chip--active" : ""}`}
              onClick={() => setCustomDuration(true)}
            >
              Другое
            </button>
          </div>
          {customDuration ? (
            <input
              className="pay-input"
              type="number"
              min="1"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              style={{ marginTop: 8 }}
            />
          ) : null}
        </div>

        <div className="pay-field">
          <label>Общая стоимость, ₽</label>
          <input
            className="pay-input"
            type="number"
            min="0"
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="8000"
          />
          {unitsNum > 0 && amountNum > 0 ? (
            <p className="pay-hint" style={{ marginTop: 6 }}>
              {unitsNum} занятий · {formatMoney(amountNum)}
              <br />
              Стоимость занятия: {formatMoney(perUnit)}
            </p>
          ) : null}
        </div>

        <div className="pay-field-row">
          <div className="pay-field">
            <label>Дата начала</label>
            <input className="pay-input" type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </div>
          <div className="pay-field">
            <label>Срок действия <span className="pay-optional">необязательно</span></label>
            <input className="pay-input" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </div>
        </div>

        <div className="pay-actions">
          <button type="button" className="pay-btn" onClick={onClose} disabled={busy}>Отмена</button>
          <button type="button" className="pay-btn pay-btn--primary" onClick={submit} disabled={busy}>
            {busy ? "Создание…" : "Создать"}
          </button>
        </div>
      </div>
    </CabinetModal>
  );
}
