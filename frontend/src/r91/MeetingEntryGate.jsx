/**
 * r91: ворота перед комнатой урока.
 * - не вошли -> «Войдите в аккаунт ученика» с маской email ученика урока и вариантами входа (next сохраняется);
 * - ученик открыл ссылку прошедшего урока серии -> переход в текущий/следующий урок серии;
 * - следующего урока нет -> понятное сообщение.
 * Дочерний элемент (комната) всегда остаётся на одном месте дерева, чтобы не рвать звонок.
 */
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import SocialLoginButtons from "../components/SocialLoginButtons";
import { loginHref, r91Json } from "./r91Api";
import "./r91.css";

export default function MeetingEntryGate({ meetingUuid, bypass = false, children }) {
  const navigate = useNavigate();
  const [state, setState] = useState({ kind: bypass ? "ok" : "loading" });

  useEffect(() => {
    if (bypass || state.kind === "ok") return undefined;
    let alive = true;
    r91Json(`/meeting-entry/${encodeURIComponent(meetingUuid)}/`)
      .then(({ ok, data }) => {
        if (!alive) return;
        if (!ok) { setState({ kind: "ok" }); return; }
        if (!data.authenticated) { setState({ kind: "login", data }); return; }
        if (data.redirect) { navigate(data.redirect, { replace: true }); return; }
        if (data.finished_no_next) { setState({ kind: "finished", data }); return; }
        setState({ kind: "ok" });
      })
      .catch(() => alive && setState({ kind: "ok" }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingUuid, bypass]);

  if (bypass || state.kind === "ok") return children;
  if (state.kind === "loading") return <div className="r91-gate r91-gate--loading" aria-busy="true" />;
  const next = `/cabinet/meetings/${meetingUuid}`;
  if (state.kind === "finished") {
    return (
      <div className="r91-gate" data-testid="r91-finished">
        <div className="r91-card">
          <h1>Этот урок уже завершён</h1>
          <p>Следующего занятия в этой серии пока нет в расписании. Когда преподаватель его назначит, оно появится в разделе «Мои занятия».</p>
          <div className="r91-actions">
            <Link className="r91-btn r91-btn--primary" to="/cabinet/student/lessons">Мои занятия</Link>
            <Link className="r91-btn" to="/cabinet">В кабинет</Link>
          </div>
        </div>
      </div>
    );
  }
  const hint = state.data?.student_email_hint;
  return (
    <div className="r91-gate" data-testid="r91-login">
      <div className="r91-card">
        <div className="r91-brand">Цифровой поток</div>
        <h1>Войдите в аккаунт ученика</h1>
        <p>
          Это ссылка на урок. Урок привязан к аккаунту ученика
          {hint ? <> <b className="r91-mask">{hint}</b></> : null}.
          {" "}Войдите в этот аккаунт — и сразу попадёте на занятие.
        </p>
        {state.data?.finished ? (
          <p className="r91-note">Этот урок уже прошёл — после входа откроем ваше текущее или ближайшее занятие.</p>
        ) : null}
        <a className="r91-btn r91-btn--primary" href={loginHref(next)}>Войти по email и паролю</a>
        <div className="r91-or">или</div>
        <SocialLoginButtons nextPath={next} />
        <p className="r91-note">
          Не создавайте новый аккаунт: у ученика он уже есть, и все занятия привязаны к нему.
          {" "}<a href={loginHref(next, { mode: "forgot" })}>Забыли пароль?</a>
        </p>
      </div>
    </div>
  );
}
