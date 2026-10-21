/** r91: завершение входа через Яндекс/VK для нового email — выбор роли вместо молчаливого «учителя». */
import { useEffect, useState } from "react";
import { loginHref, r91Json } from "./r91Api";
import "./r91.css";

export default function OAuthRolePage() {
  const [info, setInfo] = useState(null);
  const [role, setRole] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    r91Json("/oauth/pending/").then(({ ok, data }) => {
      if (!ok) { setInfo({ missing: true }); return; }
      setInfo(data);
      setRole(data.default_role || "");
    }).catch(() => setInfo({ missing: true }));
  }, []);

  const go = (url) => { window.location.assign(url || "/cabinet"); };
  const submit = async () => {
    if (!role) { setError("Выберите, кто вы: ученик или преподаватель"); return; }
    setBusy(true); setError("");
    const { ok, data } = await r91Json("/oauth/complete/", { method: "POST", body: { role } });
    setBusy(false);
    if (!ok) { setError(data.error || "Не удалось завершить вход, попробуйте ещё раз"); return; }
    go(data.redirect);
  };
  const useExisting = async () => {
    const { data } = await r91Json("/oauth/cancel/", { method: "POST" });
    go(data.redirect || loginHref(info?.next));
  };

  if (!info) return <div className="r91-gate r91-gate--loading" aria-busy="true" />;
  if (info.missing) {
    return (
      <div className="r91-gate"><div className="r91-card">
        <h1>Сессия входа устарела</h1>
        <p>Начните вход заново.</p>
        <a className="r91-btn r91-btn--primary" href="/cabinet/login">Ко входу</a>
      </div></div>
    );
  }
  const warnStudent = info.student_link || info.name_match_student;
  return (
    <div className="r91-gate" data-testid="r91-role">
      <div className="r91-card">
        <div className="r91-brand">Цифровой поток</div>
        <h1>{info.first_name ? `${info.first_name}, кто вы?` : "Кто вы?"}</h1>
        <p>Вы входите через {info.provider}{info.email_hint ? <> (<span className="r91-mask">{info.email_hint}</span>)</> : null}. Аккаунта с этим email у нас ещё нет — создадим новый.</p>
        {warnStudent ? (
          <div className="r91-warn" role="note">
            {info.meeting_student_email_hint
              ? <>Эта ссылка на урок привязана к аккаунту ученика <b className="r91-mask">{info.meeting_student_email_hint}</b>. Если это вы — войдите в него, иначе занятия не будут видны.</>
              : info.name_match_student
                ? <>Похоже, у вас уже есть аккаунт ученика с таким именем. Войдите в него — там ваши занятия.</>
                : <>Если преподаватель уже добавил вас, войдите в существующий аккаунт ученика — там ваши занятия.</>}
            <div><button type="button" className="r91-btn r91-btn--primary" onClick={useExisting}>Войти в существующий аккаунт</button></div>
          </div>
        ) : null}
        <div className="r91-roles" role="radiogroup" aria-label="Роль">
          {[["student", "Я ученик"], ["teacher", "Я преподаватель"]].map(([val, label]) => (
            <label key={val} className={`r91-role ${role === val ? "is-on" : ""}`}>
              <input type="radio" name="r91role" value={val} checked={role === val} onChange={() => setRole(val)} />
              {label}
            </label>
          ))}
        </div>
        {error ? <p className="r91-error" role="alert">{error}</p> : null}
        <button type="button" className={`r91-btn ${warnStudent ? "" : "r91-btn--primary"}`} disabled={busy} onClick={submit}>
          {busy ? "Создаём…" : "Создать новый аккаунт"}
        </button>
        {!warnStudent ? (
          <p className="r91-note">Уже есть аккаунт с другим email? <button type="button" className="r91-link" onClick={useExisting}>Войти в него</button></p>
        ) : null}
      </div>
    </div>
  );
}
