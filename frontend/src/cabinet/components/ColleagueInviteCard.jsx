import { useEffect, useState } from "react";
import { fetchColleagueInvite } from "../../utils/cabinetAuth";
import { ensureDeviceId } from "../colleagueInvite";

function pluralDays(n) {
  const abs = Math.abs(Number(n) || 0) % 100;
  const n1 = abs % 10;
  if (abs > 10 && abs < 20) return "дней";
  if (n1 === 1) return "день";
  if (n1 >= 2 && n1 <= 4) return "дня";
  return "дней";
}

function absoluteUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
}

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

  if (!data?.enabled || !data?.path) return null;

  const url = absoluteUrl(data.path);
  const days = Number(data.bonus_days || 0);
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
          Личная ссылка на регистрацию. Когда коллега выдаст первое домашнее задание
          или проведёт урок, вам начислятся {days} {pluralDays(days)} тарифа «Репетитор».
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
        Приглашено <strong>{data.invited ?? 0}</strong>
        <span aria-hidden="true"> · </span>
        Квалифицировано <strong>{data.qualified ?? 0}</strong>
      </p>
    </section>
  );
}
