import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { trackActivationIntent } from "../activationAnalytics";
import { dismissUiNotice } from "../../utils/cabinetAuth";

function progressLabel(done, total) {
  return `${done} из ${total} шагов выполнено`;
}

export default function TeacherOnboardingCard({ onboarding, onDismissed }) {
  const steps = Array.isArray(onboarding?.steps) ? onboarding.steps : [];
  const activationSteps = steps.filter((step) => step.key !== "registered");
  const completed = activationSteps.filter((step) => step.done).length;
  const total = onboarding?.total_steps || activationSteps.length || 3;
  const percent = total ? Math.round((completed / total) * 100) : 0;
  const cta = onboarding?.cta;
  const nextStep = onboarding?.next_step;
  const title = cta?.title || "Первые шаги";
  const [hiding, setHiding] = useState(false);

  useEffect(() => {
    if (!onboarding?.visible) return;
    if (nextStep === "student" || nextStep === "invite") {
      trackActivationIntent("add_student_cta_viewed", { source: "onboarding_card" });
    }
  }, [onboarding?.visible, nextStep]);

  if (!onboarding?.visible) return null;

  const onCtaClick = () => {
    if (onboarding.next_step === "student" || onboarding.next_step === "invite") {
      trackActivationIntent("add_student_clicked", { source: "onboarding_card" });
    } else if (onboarding.next_step === "share" || onboarding.next_step === "accepted") {
      trackActivationIntent("student_invite_share_clicked", { source: "onboarding_card" });
    }
  };

  const dismiss = async () => {
    setHiding(true);
    try {
      await dismissUiNotice("first_day_checklist");
      onDismissed?.();
    } catch {
      setHiding(false);
    }
  };

  return (
    <article className="td-card td-onboarding" aria-label={title}>
      <div className="td-onboarding__head">
        <div>
          <h2>{title}</h2>
          <p>{progressLabel(completed, total)}</p>
        </div>
        <div className="td-onboarding__actions">
          {cta ? (
            <Link to={cta.href} className="td-button td-button-primary" onClick={onCtaClick}>
              {cta.label}
            </Link>
          ) : null}
          <button type="button" className="td-onboarding__dismiss" onClick={dismiss} disabled={hiding}>
            Скрыть
          </button>
        </div>
      </div>

      <div
        className="td-onboarding__bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={progressLabel(completed, total)}
      >
        <span style={{ width: `${percent}%` }} />
      </div>

      <ol className="td-onboarding__steps">
        {activationSteps.map((step) => {
          const done = step.done;
          return (
            <li
              key={step.key}
              className={`td-onboarding__step${done ? " is-done" : ""}${
                cta?.step === step.key ? " is-current" : ""
              }`}
            >
              <span className="td-onboarding__mark" aria-hidden="true">
                {done ? "✓" : "○"}
              </span>
              <span>{step.label}</span>
            </li>
          );
        })}
      </ol>
      {cta?.hint ? <p className="td-onboarding__hint">{cta.hint}</p> : null}
      {cta?.alt_href ? (
        <p className="td-onboarding__alt">
          <Link to={cta.alt_href}>{cta.alt_label || "Собрать вариант"}</Link>
        </p>
      ) : null}
    </article>
  );
}
