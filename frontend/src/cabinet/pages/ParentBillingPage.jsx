import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { claimParentPayment, fetchParentBilling, fetchParentChildren } from "../../utils/cabinetAuth";
import ParentChildSwitcher from "../parent/ParentChildSwitcher";
import { StudentErrorState, StudentPageShell } from "../student/StudentSectionUi";

export default function ParentBillingPage() {
  const [params, setParams] = useSearchParams();
  const studentId = params.get("student") ? Number(params.get("student")) : null;
  const [children, setChildren] = useState([]);
  const [billing, setBilling] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [claimNote, setClaimNote] = useState("");
  const [claimAmount, setClaimAmount] = useState("");
  const [claimStatus, setClaimStatus] = useState("");
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    fetchParentChildren()
      .then((res) => {
        const list = res.children || [];
        setChildren(list);
        if (!studentId && list[0]?.student_id) {
          const p = new URLSearchParams(params);
          p.set("student", String(list[0].student_id));
          setParams(p, { replace: true });
        }
      })
      .catch((err) => setError(err.message || "Ошибка"));
  }, [studentId, params, setParams]);

  const load = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetchParentBilling({ student_id: studentId });
      setBilling(res);
    } catch (err) {
      setError(err.message || "Не удалось загрузить оплату");
      setBilling(null);
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onClaim = async (e) => {
    e.preventDefault();
    if (!studentId) return;
    setClaiming(true);
    setClaimStatus("");
    try {
      const res = await claimParentPayment({
        student_id: studentId,
        amount: claimAmount || undefined,
        note: claimNote,
      });
      setClaimStatus(
        res.delivered
          ? "Преподаватель получил уведомление. Он проверит оплату вручную."
          : "Уведомление отправлено, но преподаватель отключил такие оповещения.",
      );
      setClaimNote("");
    } catch (err) {
      setClaimStatus(err.message || "Не удалось отправить уведомление");
    } finally {
      setClaiming(false);
    }
  };

  const account = billing?.account;
  const txs = account?.recent_transactions || [];

  return (
    <StudentPageShell>
      <ParentChildSwitcher
        kids={children}
        activeId={studentId}
        onChange={(id) => {
          const p = new URLSearchParams(params);
          p.set("student", String(id));
          setParams(p);
        }}
      />

      {loading ? <div className="st-loading">Загрузка…</div> : null}
      {error ? <StudentErrorState message={error} onRetry={load} /> : null}

      {!loading && billing && billing.allowed === false ? (
        <div className="st-empty">
          <h3 className="st-empty__title">Финансы скрыты</h3>
          <p className="st-empty__text">
            Преподаватель не открыл родителю доступ к оплате этого ученика.
          </p>
        </div>
      ) : null}

      {!loading && billing?.allowed && account ? (
        <>
          <section className="st-home-block">
            <div className="st-home-block__head">
              <h2 className="st-home-block__title">Текущее состояние</h2>
            </div>
            <p>Долг: {account.summary?.debt_amount ?? "0"} {account.currency}</p>
            <p className="st-muted">
              Остаток абонемента: {account.summary?.available_units ?? "—"} ·
              Неоплаченных занятий: {account.summary?.unpaid_completed_lessons ?? 0}
            </p>
          </section>

          <section className="st-home-block">
            <div className="st-home-block__head">
              <h2 className="st-home-block__title">История оплат</h2>
            </div>
            {txs.length === 0 ? (
              <p className="st-muted">Пока нет операций</p>
            ) : (
              <ul className="st-simple-list">
                {txs.slice(0, 20).map((tx) => (
                  <li key={tx.id || `${tx.created_at}-${tx.amount}`} className="st-list-card">
                    <strong>
                      {tx.amount} {tx.currency || account.currency}
                    </strong>
                    <p className="st-muted">
                      {tx.title || tx.type || "Операция"}
                      {tx.created_at ? ` · ${new Date(tx.created_at).toLocaleDateString("ru-RU")}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <p className="st-muted">
              Данные синхронизированы с кабинетом преподавателя. Родитель не может менять платежи.
            </p>
          </section>

          <section className="st-home-block">
            <div className="st-home-block__head">
              <h2 className="st-home-block__title">Уведомить преподавателя об оплате</h2>
            </div>
            <p className="st-muted">
              Если вы уже перевели оплату, сообщите преподавателю — он проверит поступление.
            </p>
            <form className="st-form" onSubmit={onClaim}>
              <label className="st-field">
                <span>Сумма (необязательно)</span>
                <input
                  value={claimAmount}
                  onChange={(e) => setClaimAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="Например, 3000"
                />
              </label>
              <label className="st-field">
                <span>Комментарий</span>
                <textarea
                  rows={3}
                  value={claimNote}
                  onChange={(e) => setClaimNote(e.target.value)}
                  placeholder="Способ оплаты, дата перевода…"
                />
              </label>
              <button type="submit" className="cb-btn cb-btn--primary" disabled={claiming}>
                {claiming ? "Отправка…" : "Уведомить преподавателя"}
              </button>
            </form>
            {claimStatus ? <p className="st-muted" role="status">{claimStatus}</p> : null}
          </section>
        </>
      ) : null}
    </StudentPageShell>
  );
}
