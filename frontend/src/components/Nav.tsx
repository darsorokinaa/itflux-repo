import { FormEvent, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { getActiveNavTab, NAV_TABS, type NavTabDef } from "../config/navTabs";
import SoonModal from "./SoonModal";
import { displayName } from "../pages/CabinetAuthPage";
import { fetchCabinetSession, getCabinetHomePath } from "../utils/cabinetAuth";
import { openSupport } from "../cabinet/support";

function pickFirstNonEmptyString(values: unknown[]) {
  for (const value of values) {
    const str = typeof value === "string" ? value.trim() : "";
    if (str) return str;
  }
  return "";
}

function readUrlField(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  const candidate = value as Record<string, unknown>;
  return pickFirstNonEmptyString([candidate.url, candidate.src, candidate.href]);
}

function normalizeAvatarUrl(url: string): string {
  if (!url) return "";
  if (typeof window === "undefined") return url;
  if (url.startsWith("http://127.0.0.1:8000")) return url.replace("http://127.0.0.1:8000", "");
  if (url.startsWith("http://localhost:8000")) return url.replace("http://localhost:8000", "");
  if (url.startsWith("//")) return `${window.location.protocol}${url}`;
  return url;
}

function resolveUserAvatarUrl(user: unknown): string {
  if (!user || typeof user !== "object") return "";
  const record = user as Record<string, unknown>;
  const profile = record.profile && typeof record.profile === "object"
    ? (record.profile as Record<string, unknown>)
    : null;

  const fromTop = pickFirstNonEmptyString([
    readUrlField(record.avatar),
    record.avatar_url,
    readUrlField(record.photo),
    record.photo_url,
    readUrlField(record.image),
    record.image_url,
    record.picture,
  ]);

  const fromProfile = profile
    ? pickFirstNonEmptyString([
      readUrlField(profile.avatar),
      profile.avatar_url,
      readUrlField(profile.photo),
      profile.photo_url,
      readUrlField(profile.image),
      profile.image_url,
      profile.picture,
    ])
    : "";

  return normalizeAvatarUrl(fromTop || fromProfile);
}

function FluxIcon({ children }: { children: ReactNode }) {
  return (
    <svg className="flux-icon" viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  );
}

function TabIcon({ tabKey }: { tabKey: string }) {
  if (tabKey === "tasks") {
    return (
      <FluxIcon>
        <rect x="4" y="4" width="6" height="6" rx="1.4" />
        <rect x="14" y="4" width="6" height="6" rx="1.4" />
        <rect x="4" y="14" width="6" height="6" rx="1.4" />
        <rect x="14" y="14" width="6" height="6" rx="1.4" />
      </FluxIcon>
    );
  }
  if (tabKey === "my-tasks") {
    return (
      <FluxIcon>
        <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h4l2 2H18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
        <path d="M8 11h8M8 15h5" />
      </FluxIcon>
    );
  }
  if (tabKey === "generator") {
    return (
      <FluxIcon>
        <rect x="5" y="3" width="14" height="18" rx="2.3" />
        <path d="M9 7h6M9 11h6M9 15h2M14 15l1 1 2-2" />
      </FluxIcon>
    );
  }
  if (tabKey === "lessons") {
    return (
      <FluxIcon>
        <path d="M12 6c-2-2-5.5-2.5-9-1.5V19c3.5-1 7-.5 9 1.5 2-2 5.5-2.5 9-1.5V4.5c-3.5-1-7-.5-9 1.5ZM12 6v14.5" />
      </FluxIcon>
    );
  }
  if (tabKey === "worksheets") {
    return (
      <FluxIcon>
        <path d="m4 20 11-11 3 3L7 23ZM14 10l3 3M6 3v4M4 5h4M18 2v4M16 4h4M20 17v4M18 19h4" />
      </FluxIcon>
    );
  }
  if (tabKey === "interesting") {
    return (
      <FluxIcon>
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="m10 9 5 3-5 3ZM7 22h10" />
      </FluxIcon>
    );
  }
  return (
    <FluxIcon>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5.3a3 3 0 0 1 0 5.4M18 14a5 5 0 0 1 3 4.6V20" />
    </FluxIcon>
  );
}

function LogoMark() {
  const src = `${import.meta.env.BASE_URL}favicon.png?v=1`;
  return (
    <img
      src={src}
      alt=""
      className="flux-brand-mark"
      width={36}
      height={36}
      loading="eager"
      decoding="async"
    />
  );
}

type SessionUser = {
  role?: string;
  name?: string;
  surname?: string;
  username?: string;
  email?: string;
  avatar?: string | null;
};

type SpendLine = { key: string; label: string; amount: number };

const FALLBACK_SPEND: SpendLine[] = [
  { key: "ai_new_task", label: "Новое задание", amount: 3 },
  { key: "task_rewrite", label: "Переформулировка", amount: 1 },
  { key: "task_theme_adaptation", label: "Адаптация под тему", amount: 1 },
  { key: "ai_design", label: "Оформление", amount: 5 },
  { key: "theory_block", label: "Теория", amount: 2 },
  { key: "image_generation", label: "Картинка к заданию", amount: 8 },
];

function tokenWord(count: number) {
  const abs = Math.abs(count) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return "токенов";
  if (last === 1) return "токен";
  if (last >= 2 && last <= 4) return "токена";
  return "токенов";
}

function useHeaderSession() {
  const [authed, setAuthed] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [tokens, setTokens] = useState<number | null>(null);
  const [spend, setSpend] = useState<SpendLine[]>(FALLBACK_SPEND);

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      fetchCabinetSession()
        .then((data) => {
          if (cancelled) return;
          const nextAuthed = !!data?.authenticated;
          const nextUser = (nextAuthed && data?.user ? data.user : null) as SessionUser | null;
          setAuthed(nextAuthed);
          setUser(nextUser);
          const rawAvatar = typeof nextUser?.avatar === "string" ? nextUser.avatar.trim() : "";
          setAvatarUrl(nextAuthed ? (rawAvatar || resolveUserAvatarUrl(nextUser)) : "");
          if (!nextAuthed || nextUser?.role !== "teacher") {
            setTokens(null);
            return;
          }
          fetch("/api/cabinet/ai/worksheets/balance/", { credentials: "same-origin" })
            .then((response) => (response.ok ? response.json() : null))
            .then((payload) => {
              if (cancelled || !payload || typeof payload.balance !== "number") return;
              setTokens(payload.balance);
              if (Array.isArray(payload.costs) && payload.costs.length) {
                setSpend(payload.costs.filter((item: SpendLine) => item && typeof item.amount === "number" && item.label));
              }
            })
            .catch(() => {
              if (!cancelled) setTokens(null);
            });
        })
        .catch(() => {
          if (cancelled) return;
          setAuthed(false);
          setUser(null);
          setAvatarUrl("");
          setTokens(null);
        });
    };

    load();
    const onFocus = () => load();
    const onVisibility = () => {
      if (document.visibilityState === "visible") load();
    };
    const onTokens = () => load();
    window.addEventListener("focus", onFocus);
    window.addEventListener("itflux:ai-tokens", onTokens);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("itflux:ai-tokens", onTokens);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const name = user ? displayName(user) : "";
  const initial = name ? name.charAt(0).toUpperCase() : "";
  const isTeacher = user?.role === "teacher";
  const href = authed ? getCabinetHomePath(user) : "/cabinet/login";
  const label = authed
    ? (isTeacher ? `Кабинет учителя — ${name}` : `Личный кабинет — ${name}`)
    : "Личный кабинет";

  return { authed, user, avatarUrl, setAvatarUrl, tokens, spend, isTeacher, href, label, initial, name };
}

function PrivateMark() {
  return (
    <span className="flux-private-mark" title="Личный раздел" aria-label="Личный раздел">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </svg>
    </span>
  );
}

function NavTab({
  tab,
  isActive,
  onSoon,
}: {
  tab: NavTabDef;
  isActive: boolean;
  onSoon: (title: string) => void;
}) {
  const className = "flux-nav-link";
  const icon = tab.key === "my-tasks" ? <PrivateMark /> : <TabIcon tabKey={tab.key} />;
  const badge = tab.badge ? (
    <span className="flux-nav-badge">{tab.badge}</span>
  ) : tab.soon ? (
    <span className="flux-nav-badge">скоро</span>
  ) : null;

  if (tab.disabled) {
    return (
      <span className={`${className} is-disabled`} aria-disabled="true" title="Раздел в разработке">
        {icon}
        <span>{tab.label}</span>
        {badge}
      </span>
    );
  }

  if (tab.soon) {
    return (
      <button type="button" className={className} onClick={() => onSoon(tab.label)}>
        {icon}
        <span>{tab.label}</span>
        {badge}
      </button>
    );
  }

  return (
    <Link to={tab.to || "/"} className={className} aria-current={isActive ? "page" : undefined}>
      {icon}
      <span>{tab.label}</span>
      {badge}
    </Link>
  );
}

function CabinetLink({
  session,
}: {
  session: ReturnType<typeof useHeaderSession>;
}) {
  return (
    <Link to={session.href} className="flux-cabinet" aria-label={session.label} title={session.label}>
      <span className={`flux-avatar${session.authed && session.avatarUrl ? " flux-avatar--photo" : ""}`} aria-hidden="true">
        {session.authed && session.avatarUrl ? (
          <img
            src={session.avatarUrl}
            alt=""
            onError={() => session.setAvatarUrl("")}
          />
        ) : session.authed && session.initial ? (
          session.initial
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="8" r="3.5" />
            <path d="M5 21v-2a7 7 0 0 1 14 0v2" />
          </svg>
        )}
      </span>
      <span className="flux-cabinet__label">Личный кабинет</span>
    </Link>
  );
}

function TokenMenu({
  tokens,
  spend,
}: {
  tokens: number;
  spend: SpendLine[];
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const label = Math.floor(tokens).toLocaleString("ru-RU");
  const aiSpend = spend.filter((item) => item.amount > 0 && item.key !== "base_worksheet_generation" && item.key !== "task_from_bank");
  const spendOf = (key: string) => spend.find((item) => item.key === key)?.amount;
  const typicalHelp = 10 * (spendOf("ai_new_task") ?? 3) + (spendOf("ai_design") ?? 5);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="flux-popover-wrap" ref={wrapRef}>
      <button
        type="button"
        className="flux-token-button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Баланс: ${label} ${tokenWord(tokens)}. Открыть меню`}
        onClick={() => setOpen((value) => !value)}
      >
        <FluxIcon>
          <path d="m10 3 2.5 6.5L19 12l-6.5 2.5L10 21l-2.5-6.5L1 12l6.5-2.5ZM20 2v5M17.5 4.5h5" />
        </FluxIcon>
        <span className="flux-token-count">{label}</span>
        <span className="flux-token-label">{tokenWord(tokens)}</span>
        <svg className="flux-icon flux-token-arrow" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div className="flux-popover" id={panelId}>
          <div className="flux-token-summary">
            <small>Ваши AI-токены</small>
            <strong>{label}</strong>
            <p>Для создания и оформления учебных материалов. Лист можно собрать бесплатно.</p>
          </div>
          <ul className="flux-token-spend">
            {aiSpend.map((item) => (
              <li key={item.key}>
                <span>{item.label}</span>
                <b>{item.amount}</b>
              </li>
            ))}
          </ul>
          <p className="flux-token-example">10 новых заданий и оформление — {typicalHelp} токенов.</p>
          <Link className="flux-popover-link flux-topup" to="/pricing" onClick={() => setOpen(false)}>
            <FluxIcon>
              <path d="M12 5v14M5 12h14" />
            </FluxIcon>
            Пополнить баланс
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function HeaderSearch() {
  const navigate = useNavigate();
  const taskRef = useRef<HTMLInputElement>(null);
  const variantRef = useRef<HTMLInputElement>(null);
  const [taskId, setTaskId] = useState("");
  const [variantId, setVariantId] = useState("");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") return;
      const target = event.target as HTMLElement | null;
      const typing = !!target && (
        target.tagName === "INPUT"
        || target.tagName === "TEXTAREA"
        || target.isContentEditable
      );
      if (typing && target !== taskRef.current && target !== variantRef.current) return;
      event.preventDefault();
      taskRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const openResult = (kind: "task" | "variant", value: string) => {
    const query = value.trim();
    if (!query) return;
    if (kind === "variant") navigate(`/search-variant?q=${encodeURIComponent(query)}`);
    else navigate(`/search/tasks?q=${encodeURIComponent(query)}`);
    setTaskId("");
    setVariantId("");
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const task = taskId.trim();
    const variant = variantId.trim();
    if (document.activeElement === variantRef.current && variant) {
      openResult("variant", variant);
      return;
    }
    if (task) {
      openResult("task", task);
      return;
    }
    if (variant) openResult("variant", variant);
  };

  return (
    <form className="flux-inline-search" role="search" aria-label="Поиск по номеру" onSubmit={onSubmit}>
      <label>
        <span className="flux-sr-only">Номер задания</span>
        <input
          ref={taskRef}
          type="search"
          value={taskId}
          placeholder="№ задания"
          maxLength={120}
          autoComplete="off"
          enterKeyHint="search"
          onChange={(event) => setTaskId(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            openResult("task", event.currentTarget.value);
          }}
        />
      </label>
      <span className="flux-inline-search__divider" aria-hidden="true" />
      <label>
        <span className="flux-sr-only">Номер варианта</span>
        <input
          ref={variantRef}
          type="search"
          value={variantId}
          placeholder="№ варианта"
          maxLength={120}
          autoComplete="off"
          enterKeyHint="search"
          onChange={(event) => setVariantId(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            openResult("variant", event.currentTarget.value);
          }}
        />
      </label>
      <button type="submit" className="flux-inline-search__submit" aria-label="Найти">
        <FluxIcon>
          <circle cx="10.7" cy="10.7" r="6.6" />
          <path d="m16 16 4.5 4.5" />
        </FluxIcon>
      </button>
    </form>
  );
}

export default function Nav() {
  const { pathname } = useLocation();
  const active = getActiveNavTab(pathname);
  const session = useHeaderSession();
  const [soonTitle, setSoonTitle] = useState("");
  const primaryTabs = NAV_TABS.filter((tab) => (
    tab.key !== "teachers"
    && tab.key !== "worksheets"
    && (!tab.teacherOnly || session.isTeacher)
  ));
  const community = NAV_TABS.find((tab) => tab.key === "teachers");

  return (
    <header className="site-header">
      <div className="flux-header">
        <div className="flux-secondary" aria-label="Дополнительные инструменты">
          <Link to="/" className="flux-brand" aria-label="Цифровой поток — главная">
            <LogoMark />
            <span className="flux-brand-text">
              <span className="flux-wordmark">Цифровой поток</span>
              <span className="flux-brand-caption">ОГЭ · ЕГЭ · Школьная программа</span>
            </span>
          </Link>
          {community?.to ? (
            <Link
              to={community.to}
              className="flux-secondary-link"
              aria-current={active === "teachers" ? "page" : undefined}
            >
              <TabIcon tabKey="teachers" />
              <span>Сообщество<span className="flux-community-extra"> учителей</span></span>
            </Link>
          ) : null}
          <span className="flux-secondary-spacer" />
          <HeaderSearch />
          {session.isTeacher && session.tokens != null ? (
            <TokenMenu tokens={session.tokens} spend={session.spend} />
          ) : null}
        </div>
        <div className="flux-primary">
          <nav className="flux-nav" aria-label="Разделы платформы">
            {primaryTabs.map((tab) => (
              <NavTab
                key={tab.key}
                tab={tab}
                isActive={active === tab.key}
                onSoon={setSoonTitle}
              />
            ))}
          </nav>
          <div className="flux-primary-actions" aria-label="Помощь и личный кабинет">
            <button type="button" className="flux-help" onClick={() => openSupport()}>
              <FluxIcon>
                <circle cx="12" cy="12" r="9" />
                <path d="M9.4 9a2.7 2.7 0 1 1 4.4 2.1c-1 .7-1.8 1.1-1.8 2.4M12 17h.01" />
              </FluxIcon>
              <span>Помощь</span>
            </button>
            <CabinetLink session={session} />
          </div>
        </div>
      </div>
      {soonTitle ? <SoonModal title={soonTitle} onClose={() => setSoonTitle("")} /> : null}
    </header>
  );
}
