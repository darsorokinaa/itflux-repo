import { useEffect, useState } from "react";
import { fetchColleagueInvite } from "../../utils/cabinetAuth";
import { ensureDeviceId, formatRuDays } from "../colleagueInvite";

export default function ColleagueInviteCard() {
  const [data, setData] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ensureDeviceId();
    fetchColleagueInvite()
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data?.enabled || !(data.url || data.path)) return null;

  const url = data.url || data.path;
  const days = formatRuDays(data.bonus_days);
  const limit = Number(data.monthly_cap || 0);
  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const input = document.getElementById("td-colleague-url");
        input?.select();
        document.execCommand("copy");
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="td-panel td-colleague" aria-labelledby="td-colleague-title">
      <div className="td-colleague__copy">
        <h2 id="td-colleague-title">Пригласите коллегу</h2>
        <p>
          Отправьте коллеге личную ссылку. Когда он выдаст первое домашнее задание
          или проведёт урок, вам начислится {days} тарифа «Репетитор». Бонус начисляется
          не больше чем за {limit} коллег в месяц.
        </p>
      </div>
      <div className="td-colleague__row">
        <input
          id="td-colleague-url"
          className="td-colleague__url"
          readOnly
          value={url}
          aria-label="Ссылка для приглашения коллеги"
          onFocus={(event) => event.target.select()}
        />
        <button type="button" className="td-btn td-btn--blue" onClick={copy}>
          {copied ? "Скопировано" : "Скопировать"}
        </button>
      </div>
      <p className="td-colleague__stats">
        Зарегистрировались <strong>{data.invited ?? 0}</strong>
        <span aria-hidden="true"> · </span>
        Бонус начислен <strong>{data.qualified ?? 0}</strong>
      </p>
    </section>
  );
}
