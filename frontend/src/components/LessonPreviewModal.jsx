import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { rememberReturnPath, safeReturnPath } from "../accessGate/accessGate";
import MaterialDemoWarningModal from "./MaterialDemoWarningModal";
import { useCabinetAuthed } from "../hooks/useAccessGate";
import { trackGoal } from "../utils/analytics";
import { trackActivationIntent } from "../cabinet/activationAnalytics";
import {
  confirmMockSubscriptionPayment,
  fetchPublicPricingPlans,
  fetchReadyLesson,
  purchaseReadyLesson,
  startReadyLessonDemo,
  syncSubscriptionPayment,
} from "../utils/cabinetAuth";
import {
  getLessonViewerUrl,
  inferLessonIncludes,
  lessonExamLabel,
  lessonIsReadyToRun,
  lessonPreviewUrl,
  userFacingAccessCtaLabel,
} from "../cabinet/lessonCardUtils";
import { authSearchWithNext, rememberValueReached, trackValueGoal } from "../utils/valuePath";
import {
  bumpPaywallViews,
  rememberRecentLesson,
  similarLessons,
  subscriptionBreakEven,
} from "../utils/recentLessons";
import CatalogEngagementBar from "./CatalogEngagementBar";
import PaywallDeclineSurvey from "./PaywallDeclineSurvey";

const DIFFICULTY_LABELS = {
  beginner: "Начальный",
  medium: "Средний",
  advanced: "Продвинутый",
};

function registerHref(returnUrl) {
  const next = safeReturnPath(returnUrl) || "/lessons";
  return {
    pathname: "/cabinet/login",
    search: authSearchWithNext(next),
    state: { from: next },
  };
}

function formatPrice(amount, currency = "RUB") {
  if (amount == null) return "";
  const number = Number(amount);
  if (Number.isNaN(number)) return String(amount);
  const formatted = Number.isInteger(number)
    ? number.toLocaleString("ru-RU")
    : number.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === "RUB" ? `${formatted} ₽` : `${formatted} ${currency}`;
}

function formatDuration(minutes) {
  const value = Number(minutes);
  if (!value) return null;
  return `${value} мин`;
}

function ExpandableText({ text, className = "", lines = 3 }) {
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const contentRef = useRef(null);

  useLayoutEffect(() => {
    const node = contentRef.current;
    if (!node || expanded) return undefined;
    const measure = () => setCanExpand(node.scrollHeight > node.clientHeight + 2);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [text, expanded, lines]);

  useEffect(() => {
    setExpanded(false);
  }, [text]);

  if (!text) return null;

  return (
    <div className="material-preview__expandable">
      <p
        ref={contentRef}
        className={`${className} ${expanded ? "material-preview__text--expanded" : "material-preview__text--collapsed"}`}
        style={expanded ? undefined : { WebkitLineClamp: lines }}
      >
        {text}
      </p>
      {canExpand || expanded ? (
        <button
          type="button"
          className="material-preview__more-btn"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Свернуть" : "Ещё"}
        </button>
      ) : null}
    </div>
  );
}

export default function LessonPreviewModal({
  open,
  slug,
  onClose,
  demoExpired: demoExpiredProp = false,
  paymentId = "",
  paymentStatus = "",
  onOpened,
  catalogLessons = [],
  forEventId = "",
}) {
  const navigate = useNavigate();
  const authed = useCabinetAuthed();
  const [lesson, setLesson] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [warningOpen, setWarningOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [libraryPlanPrice, setLibraryPlanPrice] = useState(null);

  const returnUrl = slug ? lessonPreviewUrl(slug) : "/lessons";

  const load = useCallback(() => {
    if (!slug) return Promise.resolve();
    setLoading(true);
    setError("");
    return fetchReadyLesson(slug)
      .then((data) => {
        setLesson(data);
        return data;
      })
      .catch((err) => {
        setLesson(null);
        setError(err?.message || "Не удалось загрузить урок");
        return null;
      })
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    if (!open || !slug) {
      setLesson(null);
      setError("");
      return undefined;
    }
    load();
    return undefined;
  }, [open, slug, load]);

  const wasAuthedRef = useRef(authed);
  useEffect(() => {
    if (open && slug && authed && !wasAuthedRef.current) {
      load();
    }
    wasAuthedRef.current = authed;
  }, [open, slug, authed, load]);

  useEffect(() => {
    if (!open || !paymentId || !authed) return undefined;
    let cancelled = false;
    const confirm = paymentStatus === "mock"
      ? confirmMockSubscriptionPayment(paymentId)
      : syncSubscriptionPayment(paymentId);
    confirm.then(() => { if (!cancelled) load(); }).catch(() => {});
    return () => { cancelled = true; };
  }, [open, paymentId, paymentStatus, authed, load]);

  const access = lesson?.access || {};
  const demoActive = access.demo_active === true || access.can_continue_demo === true;
  const durationMinutes = access.demo_duration_minutes || 40;
  const isPaidLesson = lesson?.access_level && lesson.access_level !== "free";
  const demoExpired = demoExpiredProp || access.reason_code === "DEMO_EXPIRED";
  const canOpenContent = Boolean(lesson) && access.can_view === true;

  const priceLabel = useMemo(
    () => formatPrice(access.standalone_price, access.standalone_currency),
    [access.standalone_price, access.standalone_currency],
  );

  useEffect(() => {
    if (!open || !lesson) return;
    rememberRecentLesson(lesson);
    trackGoal("lesson_preview_viewed", {
      lesson_id: String(lesson.id || ""),
      access_type: access.access_type || "locked",
    });
    if (access.can_view !== true) {
      trackValueGoal("lesson_paywall_viewed", { lesson_id: String(lesson.id || "") });
      setDeclineOpen(bumpPaywallViews("lesson") >= 2);
    } else {
      setDeclineOpen(false);
    }
    onOpened?.(lesson);
  }, [open, lesson, access.access_type, onOpened]);

  useEffect(() => {
    if (!open || !access.required_plan || access.required_plan === "start") {
      setLibraryPlanPrice(null);
      return undefined;
    }
    let cancelled = false;
    fetchPublicPricingPlans()
      .then((data) => {
        if (cancelled) return;
        const plan = (data?.plans || []).find((item) => item.slug === access.required_plan);
        const price = Number(plan?.price_month);
        setLibraryPlanPrice(Number.isFinite(price) && price > 0 ? price : null);
      })
      .catch(() => {
        if (!cancelled) setLibraryPlanPrice(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, access.required_plan]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;
    const onKeyDown = (event) => {
      if (event.key !== "Escape" || busy) return;
      if (warningOpen) {
        setWarningOpen(false);
        return;
      }
      onClose?.();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, warningOpen, busy, onClose]);

  const onOpenContent = () => {
    if (!lesson?.slug) return;
    trackValueGoal("lesson_preview_value_reached", { lesson_id: String(lesson.id || lesson.slug) });
    rememberValueReached("lesson");
    onClose?.();
    navigate(getLessonViewerUrl(lesson.slug));
  };

  const onContinueDemo = () => {
    onOpenContent();
  };

  const onOpenDemo = () => {
    if (demoActive) {
      onContinueDemo();
      return;
    }
    if (!access.can_start_demo) return;
    trackGoal("lesson_demo_warning_viewed", {
      lesson_id: String(lesson.id),
      access_type: access.access_type || "locked",
    });
    setWarningOpen(true);
  };

  const onConfirmDemo = async () => {
    setBusy(true);
    try {
      const result = await startReadyLessonDemo(lesson.slug);
      trackGoal("lesson_demo_started", { lesson_id: String(lesson.id), access_type: "demo" });
      trackValueGoal("lesson_preview_started", { lesson_id: String(lesson.id) });
      trackValueGoal("lesson_preview_value_reached", { lesson_id: String(lesson.id) });
      rememberValueReached("lesson");
      setWarningOpen(false);
      onClose?.();
      navigate(getLessonViewerUrl(lesson.slug));
    } catch (err) {
      setError(err?.message || "Не удалось открыть демоверсию");
    } finally {
      setBusy(false);
    }
  };

  const onPurchase = async () => {
    setBusy(true);
    try {
      const result = await purchaseReadyLesson(lesson.slug, `les-${lesson.id}-${Date.now()}`);
      trackGoal("lesson_purchase_started", {
        lesson_id: String(lesson.id),
        access_type: access.access_type || "locked",
      });
      if (result?.payment_url) {
        window.location.href = result.payment_url;
        return;
      }
      await load();
    } catch (err) {
      setError(err?.message || "Не удалось начать покупку");
    } finally {
      setBusy(false);
    }
  };

  const renderCta = (cta) => {
    if (cta.type === "register") {
      const to = registerHref(returnUrl);
      return (
        <Link
          key={`${cta.type}-${cta.label}`}
          className={`material-access-btn ${cta.primary ? "material-access-btn--primary" : "material-access-btn--ghost"}`}
          to={to}
          onClick={() => {
            rememberReturnPath(returnUrl);
            trackValueGoal("signup_from_lesson", { lesson_id: String(lesson?.id || slug || "") });
          }}
        >
          {userFacingAccessCtaLabel(cta)}
        </Link>
      );
    }
    if (cta.type === "demo" && !access.can_start_demo) {
      const to = registerHref(returnUrl);
      return (
        <Link
          key={`${cta.type}-${cta.label}`}
          className={`material-access-btn ${cta.primary ? "material-access-btn--primary" : "material-access-btn--ghost"}`}
          to={to}
          onClick={() => {
            rememberReturnPath(returnUrl);
            trackValueGoal("signup_from_lesson", { lesson_id: String(lesson?.id || slug || "") });
          }}
        >
          {userFacingAccessCtaLabel({ type: "register" })}
        </Link>
      );
    }
    if (cta.type === "demo") {
      const continueDemo = demoActive || cta.label === "Продолжить демо" || cta.label === "Продолжить урок";
      return (
        <button
          key={`${cta.type}-${cta.label}`}
          type="button"
          className={`material-access-btn ${cta.primary ? "material-access-btn--primary" : "material-access-btn--ghost"}`}
          onClick={continueDemo ? onContinueDemo : onOpenDemo}
          disabled={busy}
        >
          {userFacingAccessCtaLabel(cta, { demoActive: continueDemo })}
        </button>
      );
    }
    if (cta.type === "purchase") {
      return (
        <button
          key={cta.type}
          type="button"
          className={`material-access-btn ${cta.primary ? "material-access-btn--primary" : "material-access-btn--ghost"}`}
          onClick={onPurchase}
          disabled={busy}
        >
          {userFacingAccessCtaLabel(cta)}
        </button>
      );
    }
    if (cta.type === "upgrade") {
      return (
        <Link
          key={cta.type}
          className="material-access-btn material-access-btn--ghost"
          to={authed ? "/cabinet/upgrade" : "/pricing"}
        >
          {userFacingAccessCtaLabel(cta)}
        </Link>
      );
    }
    if (cta.type === "open") {
      return (
        <button
          key={`${cta.type}-${cta.label}`}
          type="button"
          className={`material-access-btn ${cta.primary ? "material-access-btn--primary" : "material-access-btn--ghost"}`}
          onClick={onOpenContent}
          disabled={busy}
        >
          {userFacingAccessCtaLabel(cta)}
        </button>
      );
    }
    return null;
  };

  if (!open || !slug || typeof document === "undefined") return null;

  const durationLabel = formatDuration(lesson?.duration_minutes);
  const examLabel = lessonExamLabel(lesson);
  const difficultyLabel = lesson?.difficulty ? DIFFICULTY_LABELS[lesson.difficulty] : "";
  const includes = inferLessonIncludes(lesson);
  const readyNow = lessonIsReadyToRun(lesson);
  const showPaywallCompare = Boolean(
    lesson
    && isPaidLesson
    && (access.standalone_purchase_available || access.required_plan_name)
    && (demoExpired || access.demo_used || (!canOpenContent && !access.can_start_demo && !demoActive)),
  );
  const breakEvenCount = subscriptionBreakEven(access.standalone_price, libraryPlanPrice);
  const relatedLessons = similarLessons(catalogLessons, lesson);
  const materialSaved = Boolean(authed && (canOpenContent || demoActive || access.access_type === "purchase"));
  const hasHomework = includes.some((item) => item.id === "homework");
  const metaParts = lesson
    ? [
        lesson.subject,
        lesson.grade ? `${lesson.grade} класс` : null,
        examLabel,
        lesson.topic,
        durationLabel,
      ].filter(Boolean)
    : [];

  return createPortal(
    <>
      <div
        className="lesson-preview-overlay"
        role="presentation"
        onClick={(event) => {
          if (event.target === event.currentTarget && !warningOpen && !busy) onClose?.();
        }}
      >
        <div
          className="lesson-preview-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="lesson-preview-title"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="lesson-preview-modal__close"
            aria-label="Закрыть"
            onClick={onClose}
            disabled={busy}
          >
            ×
          </button>

          {loading ? (
            <div className="lesson-preview-modal__loading">Загрузка урока…</div>
          ) : error && !lesson ? (
            <div className="lesson-preview-modal__loading">
              <p>{error}</p>
            </div>
          ) : lesson ? (
            <div className={`material-preview material-preview--modal${lesson.cover_image_url ? "" : " material-preview--modal--no-cover"}`}>
              {lesson.cover_image_url ? (
                <div className="material-preview__cover-wrap">
                  <img className="material-preview__cover" src={lesson.cover_image_url} alt="" />
                </div>
              ) : null}

              <div className="material-preview__body">
                <div className="material-preview__badges">
                  {isPaidLesson ? <span className="material-access-badge">Платный материал</span> : null}
                  {demoActive ? (
                    <span className="material-access-badge material-access-badge--demo">
                      Демо · осталось {Math.max(1, Math.ceil((access.demo_remaining_seconds || 0) / 60))} мин
                    </span>
                  ) : null}
                  {access.access_type === "subscription" ? (
                    <span className="material-access-badge material-access-badge--plan">
                      Доступно по вашему тарифу
                    </span>
                  ) : null}
                </div>

                <h1 id="lesson-preview-title" className="material-preview__title">{lesson.title}</h1>
                {metaParts.length ? (
                  <p className="material-preview__meta">{metaParts.join(" · ")}</p>
                ) : null}
                {lesson.slug ? (
                  <CatalogEngagementBar
                    kind="lessons"
                    slug={lesson.slug}
                    viewsCount={lesson.views_count}
                    likesCount={lesson.likes_count}
                    isLiked={lesson.is_liked}
                  />
                ) : null}
                {lesson.short_description ? (
                  <ExpandableText text={lesson.short_description} className="material-preview__desc" lines={3} />
                ) : null}

                <div className="material-preview__facts">
                  {priceLabel && access.standalone_purchase_available ? (
                    <div className="material-preview__fact">
                      <span className="material-preview__fact-label">Отдельная покупка</span>
                      <strong>{priceLabel}</strong>
                    </div>
                  ) : null}
                  {isPaidLesson && access.required_plan_name ? (
                    <div className="material-preview__fact">
                      <span className="material-preview__fact-label">По тарифу</span>
                      <strong>{access.required_plan_name}</strong>
                    </div>
                  ) : null}
                  {durationLabel ? (
                    <div className="material-preview__fact">
                      <span className="material-preview__fact-label">Длительность</span>
                      <strong>{durationLabel}</strong>
                    </div>
                  ) : null}
                </div>

                {durationLabel || lesson?.grade || difficultyLabel || includes.length ? (
                  <div className="material-preview__section">
                    <h2>Что вы получите</h2>
                    <p className="material-preview__outcome-meta">
                      {[
                        durationLabel,
                        lesson.grade ? `${lesson.grade} класс` : null,
                        difficultyLabel,
                      ].filter(Boolean).join(" · ")}
                    </p>
                    {includes.length ? (
                      <ul className="material-preview__includes">
                        {includes.map((item) => (
                          <li key={item.id}>{item.label}</li>
                        ))}
                      </ul>
                    ) : null}
                    {lesson.teacher_goal ? (
                      <ExpandableText text={lesson.teacher_goal} lines={4} />
                    ) : null}
                    {readyNow ? <p className="material-preview__ready">Можно проводить сразу</p> : null}
                  </div>
                ) : null}

                {lesson.student_result ? (
                  <div className="material-preview__section">
                    <h2>Результат</h2>
                    <ExpandableText text={lesson.student_result} lines={4} />
                  </div>
                ) : null}

                {includes.length ? (
                  <div className="material-preview__section">
                    <h2>Как проходит урок</h2>
                    <ul className="material-preview__includes">
                      {includes.map((item) => (
                        <li key={`flow-${item.id}`}>{item.label}</li>
                      ))}
                    </ul>
                    {durationLabel ? (
                      <p className="material-preview__outcome-meta">Ориентир по длительности: {durationLabel}</p>
                    ) : null}
                  </div>
                ) : null}

                <div className="material-preview__section">
                  <h2>Что нужно от преподавателя</h2>
                  <ul className="material-preview__teacher-need">
                    <li><strong>Перед уроком.</strong> Открыть материал.</li>
                    <li><strong>На уроке.</strong> Использовать готовую структуру и задания.</li>
                    {hasHomework ? (
                      <li><strong>После урока.</strong> Выдать готовое домашнее задание.</li>
                    ) : (
                      <li><strong>После урока.</strong> Если домашнего задания в материале нет, его нужно подготовить отдельно.</li>
                    )}
                  </ul>
                  <p className="material-preview__savings">
                    Урок уже собран: не нужно искать теорию, задания и ДЗ по разным источникам. Можно открыть и использовать.
                  </p>
                </div>

                {materialSaved ? (
                  <p className="material-preview__saved" role="status">
                    Материал сохранён. Вы сможете открыть его с любого устройства.
                  </p>
                ) : null}

                {showPaywallCompare ? (
                  <div className="material-paywall-compare">
                    <h2>Продолжить этот урок</h2>
                    <div className="material-paywall-compare__grid">
                      {access.standalone_purchase_available && priceLabel ? (
                        <article className="material-paywall-compare__option">
                          <h3>Нужен только этот урок</h3>
                          <p className="material-paywall-compare__lead">Разовая покупка материала на конкретное занятие.</p>
                          <ul>
                            <li>Открыть только этот урок</li>
                            <li>{priceLabel}</li>
                          </ul>
                        </article>
                      ) : null}
                      {access.required_plan_name ? (
                        <article className="material-paywall-compare__option">
                          <h3>Регулярно нужны готовые материалы</h3>
                          <p className="material-paywall-compare__lead">Доступ к библиотеке по тарифу «{access.required_plan_name}».</p>
                          <ul>
                            <li>Получить доступ ко всей библиотеке</li>
                            {breakEvenCount ? (
                              <li>Подписка выгоднее, если нужно от {breakEvenCount} материалов</li>
                            ) : null}
                          </ul>
                        </article>
                      ) : null}
                    </div>
                    <Link className="material-paywall-compare__all" to="/pricing">
                      Сравнить все тарифы
                    </Link>
                  </div>
                ) : null}

                {declineOpen && showPaywallCompare ? (
                  <PaywallDeclineSurvey open scope="lesson" onClose={() => setDeclineOpen(false)} />
                ) : null}

                {demoExpired ? (
                  <div className="material-preview__expired" role="status">
                    <h2>Продолжить урок</h2>
                    <p>Знакомство с материалом закончилось. Откройте этот урок отдельно или получите доступ ко всем материалам по тарифу.</p>
                  </div>
                ) : demoActive ? (
                  <p className="material-paywall__message">
                    {access.message || "Урок открыт на ограниченное время. Продолжите, пока не истечёт таймер."}
                  </p>
                ) : access.message ? (
                  <p className="material-paywall__message">{access.message}</p>
                ) : null}

                {error ? <p className="material-viewer__error" role="alert">{error}</p> : null}

                <div className="material-paywall__actions">
                  {((access.cta || []).length
                    ? access.cta
                    : (canOpenContent ? [{ type: "open", label: "Открыть урок", primary: true }] : [])
                  ).map(renderCta)}
                </div>

                {access.demo_used && !demoActive && !demoExpired ? (
                  <p className="material-paywall__used">Знакомство с этим уроком уже было использовано.</p>
                ) : null}

                {authed && (canOpenContent || demoActive || access.demo_used) ? (
                  <div className="material-preview__next-step">
                    <p>Что сделать дальше</p>
                    <div className="material-preview__next-actions">
                      {forEventId ? (
                        <Link
                          className="material-access-btn material-access-btn--primary"
                          to={`/cabinet/schedule?event=${encodeURIComponent(forEventId)}`}
                        >
                          Добавить к занятию
                        </Link>
                      ) : (
                        <Link className="material-access-btn material-access-btn--ghost" to="/cabinet/schedule">
                          Добавить к занятию
                        </Link>
                      )}
                      <Link
                        className="material-access-btn material-access-btn--ghost"
                        to="/cabinet/students?invite=1"
                        onClick={() => {
                          rememberValueReached("lesson");
                          trackValueGoal("student_setup_started_after_value", { source: "lesson" });
                          trackActivationIntent("add_student_clicked", { source: "after_lesson_value" });
                        }}
                      >
                        Назначить ученику
                      </Link>
                    </div>
                  </div>
                ) : null}

                {relatedLessons.length ? (
                  <div className="material-preview__section">
                    <h2>Продолжить тему</h2>
                    <ul className="material-preview__related">
                      {relatedLessons.map((item) => (
                        <li key={item.slug}>
                          <Link to={lessonPreviewUrl(item.slug)}>{item.title}</Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {!authed && access.can_start_demo !== true && isPaidLesson ? (
                  <p className="material-preview__hint">
                    Создайте аккаунт, чтобы открыть этот урок. Он сохранится в вашем кабинете.{" "}
                    <Link
                      to={registerHref(returnUrl)}
                      onClick={() => {
                        rememberReturnPath(returnUrl);
                        trackValueGoal("signup_from_lesson", { lesson_id: String(lesson.id) });
                      }}
                    >
                      Создать аккаунт
                    </Link>
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <MaterialDemoWarningModal
        open={warningOpen}
        submitting={busy}
        durationMinutes={durationMinutes}
        onCancel={() => setWarningOpen(false)}
        onConfirm={onConfirmDemo}
      />
    </>,
    document.body,
  );
}
