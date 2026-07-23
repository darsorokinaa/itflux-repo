import { useEffect, useMemo, useRef, useState } from "react";
import CabinetModal from "./CabinetModal";
import {
  createBillingPackage,
  fetchStudentBillingAccount,
  updateBillingAccountSettings,
} from "../../utils/cabinetAuth";
import { formatMoney } from "../billing/billingFormat";
import "../styles/payments.css";

const MODES = [
  { id: "per_lesson", label: "За урок" },
  { id: "package", label: "Абонемент" },
];

const LESSON_PRESETS = [4, 8, 12];
const DURATION_PRESETS = [45, 60, 90];

function roundMoney(n) {
  if (!Number.isFinite(n) || n <= 0) return "";
  return String(Math.round(n * 100) / 100);
}

/**
 * Настройки оплаты ученика (тариф), а не фиксация поступившего платежа.
 */
export default function BillingTermsModal({
  open,
  onClose,
  studentId,
  studentName = "",
  onDone,
}) {
  const [account, setAccount] = useState(null);
  const [mode, setMode] = useState("per_lesson");
  const [lessonPrice, setLessonPrice] = useState("");
  const [duration, setDuration] = useState("60");
  const [customDuration, setCustomDuration] = useState(false);
  const [lessonsCount, setLessonsCount] = useState("8");
  const [customUnits, setCustomUnits] = useState(false);
  const [packageAmount, setPackageAmount] = useState("");
  const [packageLessonPrice, setPackageLessonPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const lastEdited = useRef("package"); // 'package' | 'unit' | 'count'

  useEffect(() => {
    if (!open || !studentId) return undefined;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchStudentBillingAccount(studentId)
      .then((data) => {
        if (cancelled) return;
        setAccount(data);
        const type = data?.billing_type || data?.settings?.billing_type || "per_lesson";
        const isPkg = type === "package_lessons" || type === "package_minutes";
        setMode(isPkg ? "package" : "per_lesson");
        const price = data?.default_lesson_price
          || data?.settings?.default_lesson_price
          || "";
        setLessonPrice(price != null && price !== "" ? String(price) : "");
        const dur = data?.settings?.default_lesson_duration_minutes || 60;
        setDuration(String(dur));
        setCustomDuration(!DURATION_PRESETS.includes(Number(dur)));
        const pkg = data?.package;
        if (pkg) {
          const units = String(pkg.total_units || "8");
          setLessonsCount(units);
          setCustomUnits(!LESSON_PRESETS.includes(Number(units)));
          const total = Number(pkg.purchase_amount || 0);
          const unit = Number(pkg.unit_price || 0)
            || (total > 0 && Number(units) > 0 ? total / Number(units) : 0);
          setPackageAmount(total > 0 ? String(total) : "");
          setPackageLessonPrice(unit > 0 ? roundMoney(unit) : (price ? String(price) : ""));
        } else {
          setLessonsCount("8");
          setCustomUnits(false);
          setPackageAmount("");
          setPackageLessonPrice(price ? String(price) : "");
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Не удалось загрузить настройки");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, studentId]);

  const unitsNum = Number(lessonsCount) || 0;
  const packageNum = Number(packageAmount) || 0;
  const unitNum = Number(packageLessonPrice) || 0;

  const computedHint = useMemo(() => {
    if (mode !== "package" || unitsNum <= 0) return "";
    if (packageNum > 0 && unitNum > 0) {
      return `${unitsNum} занятий · ${formatMoney(packageNum)} · ${formatMoney(unitNum)} за урок`;
    }
    if (packageNum > 0) {
      return `Цена урока: ${formatMoney(packageNum / unitsNum)}`;
    }
    if (unitNum > 0) {
      return `Сумма абонемента: ${formatMoney(unitNum * unitsNum)}`;
    }
    return "Укажите сумму абонемента или цену одного урока";
  }, [mode, unitsNum, packageNum, unitNum]);

  const recalcFrom = (field, nextValue) => {
    lastEdited.current = field;
    if (field === "package") {
      setPackageAmount(nextValue);
      const total = Number(nextValue) || 0;
      if (unitsNum > 0 && total > 0) {
        setPackageLessonPrice(roundMoney(total / unitsNum));
      }
      return;
    }
    if (field === "unit") {
      setPackageLessonPrice(nextValue);
      const unit = Number(nextValue) || 0;
      if (unitsNum > 0 && unit > 0) {
        setPackageAmount(roundMoney(unit * unitsNum));
      }
    }
  };

  const onCountChange = (value) => {
    setLessonsCount(value);
    const count = Number(value) || 0;
    if (count <= 0) return;
    // Количество + цена урока → сумма; иначе количество + сумма → цена урока.
    if (lastEdited.current === "unit" && unitNum > 0) {
      setPackageAmount(roundMoney(unitNum * count));
    } else if (packageNum > 0) {
      setPackageLessonPrice(roundMoney(packageNum / count));
      lastEdited.current = "package";
    } else if (unitNum > 0) {
      setPackageAmount(roundMoney(unitNum * count));
    }
  };

  if (!open) return null;

  const submit = async () => {
    if (!studentId || !account?.id) {
      setError("Не удалось определить счёт ученика");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (mode === "per_lesson") {
        const price = Number(lessonPrice);
        if (!price || price <= 0) {
          setError("Укажите стоимость одного урока");
          setBusy(false);
          return;
        }
        const updated = await updateBillingAccountSettings(account.id, {
          billing_type: "per_lesson",
          default_lesson_price: String(price),
          default_lesson_duration_minutes: Number(duration) || 60,
        });
        onDone?.(updated);
        onClose?.();
        return;
      }

      // Абонемент: сохраняем тариф и создаём/обновляем условия пакета (без фиксации оплаты).
      let total = packageNum;
      let unit = unitNum;
      if (unitsNum <= 0) {
        setError("Укажите количество занятий");
        setBusy(false);
        return;
      }
      if (total <= 0 && unit > 0) total = unit * unitsNum;
      if (unit <= 0 && total > 0) unit = total / unitsNum;
      if (total <= 0 || unit <= 0) {
        setError("Укажите сумму абонемента или цену одного урока");
        setBusy(false);
        return;
      }

      await updateBillingAccountSettings(account.id, {
        billing_type: "package_lessons",
        default_lesson_price: String(Math.round(unit * 100) / 100),
        default_lesson_duration_minutes: Number(duration) || 60,
      });

      // Создаём абонемент в статусе «ожидает оплаты», если активного ещё нет
      // или пользователь явно задаёт новые условия.
      const hasActive = account.package
        && ["active", "ending", "awaiting_payment", "partially_paid"].includes(
          account.package.display_status || account.package.status || "",
        );
      let pkg = null;
      if (!hasActive) {
        const title = `${unitsNum} занятий · ${formatMoney(total)}`;
        pkg = await createBillingPackage({
          student_id: Number(studentId),
          title,
          unit_type: "lesson",
          total_units: String(unitsNum),
          purchase_amount: String(Math.round(total * 100) / 100),
          starts_at: new Date().toISOString().slice(0, 10),
          lesson_duration_minutes: duration ? Number(duration) : null,
          auto_use: true,
          await_payment: true,
        });
      }

      onDone?.({ accountId: account.id, package: pkg });
      onClose?.();
    } catch (err) {
      setError(err.message || "Не удалось сохранить настройки");
    } finally {
      setBusy(false);
    }
  };

  return (
    <CabinetModal onClose={onClose} title="Настройки оплаты">
      <div className="pay-modal-form">
        {studentName ? (
          <p className="pay-hint" style={{ marginTop: 0 }}>
            Ученик: <strong>{studentName}</strong>
          </p>
        ) : null}
        {error ? <div className="pay-error">{error}</div> : null}
        {loading ? <p className="pay-hint">Загрузка…</p> : null}

        {!loading ? (
          <>
            <div className="pay-field">
              <label>Как оплачивают занятия</label>
              <div className="pay-chip-row">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={`pay-chip${mode === m.id ? " pay-chip--active" : ""}`}
                    onClick={() => setMode(m.id)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="pay-field">
              <label>Длительность занятия</label>
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

            {mode === "per_lesson" ? (
              <div className="pay-field">
                <label>Стоимость одного урока, ₽</label>
                <input
                  className="pay-input"
                  type="number"
                  min="0"
                  step="1"
                  value={lessonPrice}
                  onChange={(e) => setLessonPrice(e.target.value)}
                  placeholder="1600"
                  autoFocus
                />
                <p className="pay-hint" style={{ marginTop: 6 }}>
                  Это тариф ученика. Поступление денег фиксируйте отдельно через «Добавить оплату».
                </p>
              </div>
            ) : (
              <>
                <div className="pay-field">
                  <label>Количество занятий в абонементе</label>
                  <div className="pay-chip-row">
                    {LESSON_PRESETS.map((n) => (
                      <button
                        key={n}
                        type="button"
                        className={`pay-chip${!customUnits && lessonsCount === String(n) ? " pay-chip--active" : ""}`}
                        onClick={() => {
                          setCustomUnits(false);
                          onCountChange(String(n));
                        }}
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
                      value={lessonsCount}
                      onChange={(e) => onCountChange(e.target.value)}
                      style={{ marginTop: 8 }}
                    />
                  ) : null}
                </div>

                <div className="pay-field-row">
                  <div className="pay-field">
                    <label>Сумма абонемента, ₽</label>
                    <input
                      className="pay-input"
                      type="number"
                      min="0"
                      step="1"
                      value={packageAmount}
                      onChange={(e) => recalcFrom("package", e.target.value)}
                      placeholder="8000"
                    />
                  </div>
                  <div className="pay-field">
                    <label>Цена одного урока, ₽</label>
                    <input
                      className="pay-input"
                      type="number"
                      min="0"
                      step="1"
                      value={packageLessonPrice}
                      onChange={(e) => recalcFrom("unit", e.target.value)}
                      placeholder="1000"
                    />
                  </div>
                </div>
                <p className="pay-hint">{computedHint}</p>
                <p className="pay-hint">
                  Заполните любые два поля — третье посчитается само.
                  Это настройки тарифа; оплату можно внести позже.
                </p>
              </>
            )}

            <div className="pay-actions">
              <button type="button" className="pay-btn" onClick={onClose} disabled={busy}>
                Отмена
              </button>
              <button
                type="button"
                className="pay-btn pay-btn--primary"
                onClick={submit}
                disabled={busy || loading}
              >
                {busy ? "Сохранение…" : "Сохранить настройки"}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </CabinetModal>
  );
}
