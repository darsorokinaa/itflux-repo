import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  acceptInvitation,
  buildInvitationUrl,
  fetchCabinetSession,
  fetchInvitationPreview,
  getCabinetHomePath,
} from "../../utils/cabinetAuth";

function formatExpiry(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function CabinetJoinPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [session, setSession] = useState(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    document.title = "Приглашение — Личный кабинет";
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [invite, sess] = await Promise.all([
          fetchInvitationPreview(token),
          fetchCabinetSession().catch(() => ({ authenticated: false })),
        ]);
        if (!cancelled) {
          setPreview(invite);
          setSession(sess?.authenticated ? sess.user : null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || "Приглашение недействительно");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (token) load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const loginHref = `/cabinet/login?invite=${encodeURIComponent(token)}`;
  const registerHref = `/cabinet/login?invite=${encodeURIComponent(token)}&mode=register`;

  const handleAccept = async () => {
    setAccepting(true);
    setError("");
    try {
      await acceptInvitation(token);
      navigate(getCabinetHomePath(session), { replace: true });
    } catch (err) {
      setError(err.message || "Не удалось принять приглашение");
      setAccepting(false);
    }
  };

  if (loading) {
    return (
      <div className="cabinet-auth-page">
        <div className="cabinet-auth-card">
          <p className="cabinet-auth-muted">Загружаем приглашение…</p>
        </div>
      </div>
    );
  }

  if (error && !preview) {
    return (
      <div className="cabinet-auth-page">
        <div className="cabinet-auth-card">
          <h1 className="cabinet-auth-title">Приглашение недоступно</h1>
          <p className="cabinet-auth-error" role="alert">{error}</p>
          <Link to="/cabinet/login" className="cabinet-auth-submit" style={{ display: "inline-block", textAlign: "center", textDecoration: "none" }}>
            Войти в кабинет
          </Link>
        </div>
      </div>
    );
  }

  const inviteUrl = buildInvitationUrl(preview?.join_path);

  return (
    <div className="cabinet-auth-page">
      <div className="cabinet-auth-card">
        <div className="cabinet-auth-head">
          <span className="cabinet-auth-badge">Приглашение</span>
          <h1 className="cabinet-auth-title">Присоединиться к классу</h1>
          <p className="cabinet-auth-lead">
            {preview?.teacher_name
              ? `Учитель ${preview.teacher_name} приглашает вас заниматься на платформе.`
              : "Учитель приглашает вас заниматься на платформе."}
          </p>
        </div>

        <div className="cb-invite-preview">
          {preview?.group_title ? (
            <p><strong>Группа:</strong> {preview.group_title}</p>
          ) : (
            <p><strong>Формат:</strong> индивидуальные занятия</p>
          )}
          {preview?.direction_label ? (
            <p><strong>Направление:</strong> {preview.direction_label}</p>
          ) : null}
          {preview?.grade ? (
            <p><strong>Класс:</strong> {preview.grade}</p>
          ) : null}
          {preview?.message ? (
            <p className="cb-invite-preview__message">{preview.message}</p>
          ) : null}
          {preview?.expires_at ? (
            <p className="cabinet-auth-muted">Действует до {formatExpiry(preview.expires_at)}</p>
          ) : null}
        </div>

        {error ? <p className="cabinet-auth-error" role="alert">{error}</p> : null}

        {session ? (
          session.role === "student" ? (
            <button
              type="button"
              className="cabinet-auth-submit"
              disabled={accepting}
              onClick={handleAccept}
            >
              {accepting ? "Подключаем…" : "Принять приглашение"}
            </button>
          ) : (
            <p className="cabinet-auth-error">
              Войдите как ученик, чтобы принять приглашение.
            </p>
          )
        ) : (
          <div className="cb-invite-preview__actions">
            <Link to={registerHref} className="cabinet-auth-submit" style={{ textDecoration: "none", textAlign: "center" }}>
              Зарегистрироваться и принять
            </Link>
            <Link to={loginHref} className="cabinet-auth-link" style={{ display: "block", textAlign: "center", marginTop: "12px" }}>
              Уже есть аккаунт — войти
            </Link>
          </div>
        )}

        {inviteUrl ? (
          <p className="cabinet-auth-muted" style={{ marginTop: "16px", fontSize: "0.85rem", wordBreak: "break-all" }}>
            Ссылка: {inviteUrl}
          </p>
        ) : null}
      </div>
    </div>
  );
}
