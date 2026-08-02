import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import {
  acceptParentInvite,
  fetchCabinetSession,
  fetchParentInvitePreview,
  logoutCabinetAndDetachPush,
} from "../../utils/cabinetAuth";

const REL_LABELS = {
  mother: "Мама",
  father: "Папа",
  guardian: "Опекун",
  other: "Другой представитель",
};

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

function displayUser(user) {
  const full = [user?.name, user?.surname].filter(Boolean).join(" ").trim();
  return full || user?.email || user?.username || "пользователь";
}

export default function ParentInviteAcceptPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [preview, setPreview] = useState(null);
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    document.title = "Приглашение родителя — Цифровой поток";
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [invite, sess] = await Promise.all([
          fetchParentInvitePreview(token),
          fetchCabinetSession().catch(() => ({ authenticated: false })),
        ]);
        if (cancelled) return;
        setPreview(invite);
        setSession(sess?.authenticated ? sess.user : null);
      } catch (err) {
        if (!cancelled) {
          setError(err.message || "Ссылка недействительна");
          setPreview(null);
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

  const loginHref = `/cabinet/login?parent_invite=${encodeURIComponent(token)}`;
  const registerHref = `/cabinet/login?parent_invite=${encodeURIComponent(token)}&mode=register`;

  const handleAccept = async () => {
    setAccepting(true);
    setError("");
    try {
      const result = await acceptParentInvite(token);
      navigate(result?.redirect || "/cabinet/parent", { replace: true });
    } catch (err) {
      setError(err.message || "Не удалось подтвердить доступ");
    } finally {
      setAccepting(false);
    }
  };

  const handleSwitchAccount = async () => {
    setLoggingOut(true);
    setError("");
    try {
      await logoutCabinetAndDetachPush();
      setSession(null);
      navigate(loginHref, { replace: true });
    } catch (err) {
      setError(err.message || "Не удалось выйти из аккаунта");
      setLoggingOut(false);
    }
  };

  if (!token) {
    return <Navigate to="/cabinet/login" replace />;
  }

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
          <h1 className="cabinet-auth-title">Ссылка недоступна</h1>
          <p className="cabinet-auth-error" role="alert">{error}</p>
          <p className="cabinet-auth-muted">
            Обратитесь к преподавателю за новым приглашением из карточки ученика.
          </p>
          <Link
            to="/cabinet/login"
            className="cabinet-auth-submit"
            style={{ display: "inline-block", textAlign: "center", textDecoration: "none" }}
          >
            Войти в кабинет
          </Link>
        </div>
      </div>
    );
  }

  const relLabel = REL_LABELS[preview?.relationship_type] || preview?.relationship_type || "—";
  const canAccept = session?.role === "parent" || session?.role === "student";

  return (
    <div className="cabinet-auth-page">
      <div className="cabinet-auth-card">
        <div className="cabinet-auth-head">
          <span className="cabinet-auth-badge">Приглашение родителя</span>
          <h1 className="cabinet-auth-title">Подключение родительского доступа</h1>
          <p className="cabinet-auth-lead">
            Зарегистрируйтесь или войдите в аккаунт родителя, чтобы видеть учёбу ребёнка.
          </p>
        </div>

        <div className="cb-invite-preview">
          <p><strong>Ученик:</strong> {preview.student_name}</p>
          {preview.teacher_name ? (
            <p><strong>Преподаватель:</strong> {preview.teacher_name}</p>
          ) : null}
          <p><strong>Тип связи:</strong> {relLabel}</p>
          {preview.expires_at ? (
            <p className="cabinet-auth-muted">Действует до {formatExpiry(preview.expires_at)}</p>
          ) : null}
        </div>

        {error ? <p className="cabinet-auth-error" role="alert">{error}</p> : null}

        {!session ? (
          <div className="cb-invite-preview__actions">
            <Link
              to={registerHref}
              className="cabinet-auth-submit"
              style={{ textDecoration: "none", textAlign: "center" }}
            >
              Зарегистрироваться и принять
            </Link>
            <Link
              to={loginHref}
              className="cabinet-auth-link"
              style={{ display: "block", textAlign: "center", marginTop: "12px" }}
            >
              Уже есть аккаунт — войти
            </Link>
          </div>
        ) : canAccept ? (
          <>
            <p className="cabinet-auth-muted">
              Вы вошли как {displayUser(session)}.
            </p>
            <button
              type="button"
              className="cabinet-auth-submit"
              disabled={accepting}
              onClick={handleAccept}
            >
              {accepting ? "Подключаем…" : "Подтвердить доступ"}
            </button>
          </>
        ) : (
          <>
            <p className="cabinet-auth-error" role="alert">
              Сейчас вы вошли как {session.role === "teacher" ? "преподаватель" : "пользователь"} ({displayUser(session)}).
              Для родительского доступа войдите или зарегистрируйтесь как родитель — как при приглашении ученика.
            </p>
            <div className="cb-invite-preview__actions">
              <button
                type="button"
                className="cabinet-auth-submit"
                disabled={loggingOut}
                onClick={handleSwitchAccount}
              >
                {loggingOut ? "Выходим…" : "Выйти и войти как родитель"}
              </button>
              <Link
                to={registerHref}
                className="cabinet-auth-link"
                style={{ display: "block", textAlign: "center", marginTop: "12px" }}
                onClick={async (e) => {
                  e.preventDefault();
                  setLoggingOut(true);
                  try {
                    await logoutCabinetAndDetachPush();
                  } catch {
                    // всё равно уводим на регистрацию
                  }
                  navigate(registerHref, { replace: true });
                }}
              >
                Зарегистрировать аккаунт родителя
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
