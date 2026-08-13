import { Link } from "react-router-dom";

function progressLabel(done, total) {
  return `${done} из ${total} шагов выполнено`;
}

export default function TeacherOnboardingCard({ onboarding, materialsSkipped = false }) {
  if (!onboarding?.visible) return null;

  const steps = Array.isArray(onboarding.steps) ? onboarding.steps : [];
  const activationSteps = steps.filter((step) => step.key !== "registered");
  const completed = activationSteps.filter((step) => (
    step.done || (step.key === "materials" && materialsSkipped)
  )).length;
  const total = onboarding.total_steps || activationSteps.length || 5;
  const percent = total ? Math.round((completed / total) * 100) : 0;

  let cta = onboarding.cta;
  if (onboarding.next_step === "materials" && materialsSkipped) {
    const eventId = onboarding.context?.event_id;
    cta = {
      label: "Всё готово к первому уроку",
      href: eventId ? `/cabinet/schedule?event=${eventId}` : "/cabinet/schedule",
      hint: "Материалы можно добавить позже в карточке занятия.",
      step: "conduct",
    };
  }

  return (
    <article className="td-card td-onboarding" aria-label="Подготовка первого занятия">
      <div className="td-onboarding__head">
        <div>
          <h2>Подготовим первое занятие</h2>
          <p>{progressLabel(completed, total)}</p>
        </div>
        {cta ? (
          <Link to={cta.href} className="td-button td-button-primary">
            {cta.label}
          </Link>
        ) : null}
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
        {steps.map((step) => {
          const done = step.done || (step.key === "materials" && materialsSkipped);
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
    </article>
  );
}
