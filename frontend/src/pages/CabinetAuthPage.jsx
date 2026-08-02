import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { fetchCabinetSession, loginCabinet, registerCabinet, getCabinetHomePath, fetchReferralPreview } from "../utils/cabinetAuth";

const PAGE_TITLE = "Личный кабинет — вход — Цифровой поток";
const GUIDE_OPEN_ON_REGISTER_KEY = "cabinet-guide-open-on-register";

const ROLE_OPTIONS = [
  { value: "student", label: "Ученик" },
  { value: "teacher", label: "Учитель" },
  { value: "parent", label: "Родитель" },
];

function displayName(user) {
  const full = [user?.name, user?.surname].filter(Boolean).join(" ").trim();
  return full || user?.username || user?.email || "Пользователь";
}

export default function CabinetAuthPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const inviteToken = searchParams.get("invite") || "";
  const parentInviteToken = searchParams.get("parent_invite") || "";
  const referralCode = searchParams.get("ref") || searchParams.get("referral") || "";
  const redirectTo = location.state?.from
    || (parentInviteToken ? `/parent/invite/accept/${parentInviteToken}/` : "")
    || (inviteToken ? `/invite/${inviteToken}/` : "/cabinet");

  const [mode, setMode] = useState(() => (
    searchParams.get("mode") === "register" ? "register" : "login"
  ));
  const [checkingSession, setCheckingSession] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [referralPreview, setReferralPreview] = useState(null);

  const [loginForm, setLoginForm] = useState({ login: "", password: "" });
  const [registerForm, setRegisterForm] = useState({
    email: "",
    username: "",
    password: "",
    password_confirm: "",
    name: "",
    surname: "",
    role: "student",
  });

  useEffect(() => {
    if (searchParams.get("mode") === "register") {
      setMode("register");
    }
  }, [searchParams]);

  useEffect(() => {
    if (!referralCode || inviteToken) {
      setReferralPreview(null);
      return undefined;
    }
    try {
      sessionStorage.setItem("cabinet_referral_code", referralCode);
    } catch {
      // ignore storage errors
    }
    let cancelled = false;
    fetchReferralPreview(referralCode)
      .then((data) => {
        if (!cancelled) setReferralPreview(data);
      })
      .catch(() => {
        if (!cancelled) setReferralPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [referralCode, inviteToken]);

  useEffect(() => {
    document.title = PAGE_TITLE;
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchCabinetSession()
      .then((data) => {
        if (!cancelled && data?.authenticated) {
          const home = getCabinetHomePath(data.user);
          const target = redirectTo.startsWith("/cabinet") ? redirectTo : home;
          navigate(target, { replace: true });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setCheckingSession(false);
      });
    return () => {
      cancelled = true;
    };
  }, [navigate, redirectTo]);

  const goAfterAuth = async () => {
    // После входа по parent_invite сразу принимаем приглашение, как при регистрации.
    if (parentInviteToken) {
      try {
        const { acceptParentInvite } = await import("../utils/cabinetAuth");
        const accepted = await acceptParentInvite(parentInviteToken);
        navigate(accepted?.redirect || "/cabinet/parent", { replace: true });
        return;
      } catch {
        navigate(`/parent/invite/accept/${encodeURIComponent(parentInviteToken)}/`, { replace: true });
        return;
      }
    }
    const session = await fetchCabinetSession();
    const home = getCabinetHomePath(session?.user);
    const target = (
      redirectTo.startsWith("/cabinet") || redirectTo.startsWith("/parent/")
    ) ? redirectTo : home;
    navigate(target, { replace: true });
  };

  const storedReferralCode = () => {
    if (referralCode) return referralCode;
    try {
      return sessionStorage.getItem("cabinet_referral_code") || "";
    } catch {
      return "";
    }
  };

  const hasReferralSignup = Boolean(!inviteToken && storedReferralCode());

  const authPayload = (payload) => {
    let next = payload;
    if (parentInviteToken) {
      next = { ...next, parent_invite_token: parentInviteToken, role: "parent" };
    } else if (inviteToken) {
      next = { ...next, invite_token: inviteToken };
    }
    const ref = storedReferralCode();
    if (ref && !inviteToken && !parentInviteToken) {
      next = { ...next, referral_code: ref };
    }
    return next;
  };

  const onLoginSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await loginCabinet(authPayload(loginForm));
      await goAfterAuth();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось войти");
    } finally {
      setSubmitting(false);
    }
  };

  const onRegisterSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const payload = authPayload({
        ...registerForm,
        role: parentInviteToken
          ? "parent"
          : inviteToken
            ? "student"
            : (hasReferralSignup || referralPreview ? "teacher" : registerForm.role),
      });
      const result = await registerCabinet(payload);
      if (result?.redirect) {
        navigate(result.redirect, { replace: true });
        return;
      }
      try {
        sessionStorage.removeItem("cabinet_referral_code");
        sessionStorage.setItem(GUIDE_OPEN_ON_REGISTER_KEY, "1");
      } catch {
        // ignore storage errors
      }
      await goAfterAuth();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось зарегистрироваться");
    } finally {
      setSubmitting(false);
    }
  };

  if (checkingSession) {
    return (
      <div className="cabinet-auth-page">
        <div className="cabinet-auth-card">
          <p className="cabinet-auth-muted">Проверяем сессию…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="cabinet-auth-page">
      <div className="cabinet-auth-card">
        <div className="cabinet-auth-head">
          <span className="cabinet-auth-badge">Личный кабинет</span>
          <h1 className="cabinet-auth-title">Вход в аккаунт</h1>
          <p className="cabinet-auth-lead">
            {parentInviteToken
              ? "Создайте аккаунт родителя или войдите, чтобы принять приглашение к кабинету ребёнка."
              : inviteToken
              ? "Создайте аккаунт ученика или войдите, чтобы принять приглашение от учителя."
              : referralPreview
                ? `Зарегистрируйтесь как учитель — получите ${referralPreview.message} бесплатно.`
                : "Войдите или создайте аккаунт, чтобы сохранять прогресс и пользоваться материалами платформы."}
          </p>
        </div>

        {referralPreview && !inviteToken ? (
          <p className="cabinet-auth-referral" role="status">
            Реферальная ссылка «{referralPreview.title}»: {referralPreview.message}
          </p>
        ) : null}

        <div className="cabinet-auth-tabs" role="tablist" aria-label="Режим авторизации">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            className={`cabinet-auth-tab${mode === "login" ? " is-active" : ""}`}
            onClick={() => {
              setMode("login");
              setError("");
            }}
          >
            Вход
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "register"}
            className={`cabinet-auth-tab${mode === "register" ? " is-active" : ""}`}
            onClick={() => {
              setMode("register");
              setError("");
            }}
          >
            Регистрация
          </button>
        </div>

        {error ? (
          <p className="cabinet-auth-error" role="alert">
            {error}
          </p>
        ) : null}

        {mode === "login" ? (
          <form className="cabinet-auth-form" onSubmit={onLoginSubmit}>
            <label className="cabinet-auth-field">
              <span>Email или логин</span>
              <input
                type="text"
                autoComplete="username"
                required
                value={loginForm.login}
                onChange={(e) => setLoginForm((prev) => ({ ...prev, login: e.target.value }))}
              />
            </label>
            <label className="cabinet-auth-field">
              <span>Пароль</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={loginForm.password}
                onChange={(e) => setLoginForm((prev) => ({ ...prev, password: e.target.value }))}
              />
            </label>
            <button type="submit" className="cabinet-auth-submit" disabled={submitting}>
              {submitting ? "Входим…" : "Войти"}
            </button>
          </form>
        ) : (
          <form className="cabinet-auth-form" onSubmit={onRegisterSubmit}>
            <label className="cabinet-auth-field">
              <span>Email</span>
              <input
                type="email"
                autoComplete="email"
                required
                value={registerForm.email}
                onChange={(e) => setRegisterForm((prev) => ({ ...prev, email: e.target.value }))}
              />
            </label>
            <label className="cabinet-auth-field">
              <span>Логин (необязательно)</span>
              <input
                type="text"
                autoComplete="username"
                placeholder="Если не указать — будет создан из email"
                value={registerForm.username}
                onChange={(e) => setRegisterForm((prev) => ({ ...prev, username: e.target.value }))}
              />
            </label>
            <div className="cabinet-auth-row">
              <label className="cabinet-auth-field">
                <span>Имя</span>
                <input
                  type="text"
                  autoComplete="given-name"
                  value={registerForm.name}
                  onChange={(e) => setRegisterForm((prev) => ({ ...prev, name: e.target.value }))}
                />
              </label>
              <label className="cabinet-auth-field">
                <span>Фамилия</span>
                <input
                  type="text"
                  autoComplete="family-name"
                  value={registerForm.surname}
                  onChange={(e) => setRegisterForm((prev) => ({ ...prev, surname: e.target.value }))}
                />
              </label>
            </div>
            <label className="cabinet-auth-field">
              <span>Роль</span>
              <select
                value={
                  parentInviteToken
                    ? "parent"
                    : inviteToken
                      ? "student"
                      : (hasReferralSignup || referralPreview ? "teacher" : registerForm.role)
                }
                disabled={
                  Boolean(parentInviteToken)
                  || Boolean(inviteToken)
                  || Boolean(referralPreview)
                  || hasReferralSignup
                }
                onChange={(e) => setRegisterForm((prev) => ({ ...prev, role: e.target.value }))}
              >
                {(parentInviteToken
                  ? ROLE_OPTIONS.filter((opt) => opt.value === "parent")
                  : ROLE_OPTIONS.filter((opt) => opt.value !== "parent")
                ).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="cabinet-auth-field">
              <span>Пароль</span>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={registerForm.password}
                onChange={(e) => setRegisterForm((prev) => ({ ...prev, password: e.target.value }))}
              />
            </label>
            <label className="cabinet-auth-field">
              <span>Повторите пароль</span>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={registerForm.password_confirm}
                onChange={(e) =>
                  setRegisterForm((prev) => ({ ...prev, password_confirm: e.target.value }))
                }
              />
            </label>
            <button type="submit" className="cabinet-auth-submit" disabled={submitting}>
              {submitting ? "Создаём аккаунт…" : "Зарегистрироваться"}
            </button>
          </form>
        )}

        <p className="cabinet-auth-footer">
          Продолжая, вы соглашаетесь с{" "}
          <Link to="/privacy" className="cabinet-auth-link">
            политикой конфиденциальности
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

export { displayName };
