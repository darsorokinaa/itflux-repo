import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
// @ts-ignore JSX module without d.ts
import TruthTableInput from "./TruthTableInput";
// @ts-ignore JS module without d.ts
import { buildTruthTableConfigFromPrompt } from "../utils/truthTable";

/** r130: проверка ответа задачи из открытого банка — работает без регистрации, результат не сохраняется. */
export type CheckState = "idle" | "busy" | "correct" | "wrong" | "limit" | "error";

export async function checkBankTaskAnswer(taskId: number, answer: string): Promise<CheckState> {
  return (await checkBankTaskAnswerFull(taskId, answer)).state;
}

export async function checkBankTaskAnswerFull(
  taskId: number,
  answer: string
): Promise<{ state: CheckState; authenticated: boolean }> {
  const res = await fetch(`/api/tasks/${taskId}/check-answer/`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answer }),
  });
  if (res.status === 429) return { state: "limit", authenticated: false };
  if (!res.ok) return { state: "error", authenticated: false };
  const data = await res.json().catch(() => null);
  const authenticated = Boolean(data?.authenticated);
  if (!data || data.correct == null) return { state: "error", authenticated };
  return { state: data.correct ? "correct" : "wrong", authenticated };
}

export const CHECK_MESSAGES: Record<CheckState, string> = {
  idle: "",
  busy: "Проверяем…",
  correct: "Верно!",
  wrong: "Неверно. Попробуйте ещё раз или посмотрите ответ.",
  limit: "Слишком много проверок подряд. Попробуйте через несколько минут.",
  error: "Не удалось проверить ответ.",
};

export default function TaskAnswerCheck({ taskId, prompt = "" }: { taskId: number; prompt?: string }) {
  const [value, setValue] = useState("");
  const [authenticated, setAuthenticated] = useState(true);
  const [state, setState] = useState<CheckState>("idle");
  const truth = useMemo(() => buildTruthTableConfigFromPrompt(prompt), [prompt]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim() || state === "busy") return;
    setState("busy");
    try {
      const r = await checkBankTaskAnswerFull(taskId, value);
      setAuthenticated(r.authenticated);
      setState(r.state);
    } catch {
      setState("error");
    }
  };

  return (
    <form
      className={state === "idle" ? "all-tasks-check" : `all-tasks-check all-tasks-check--${state}`}
      onSubmit={onSubmit}
    >
      {truth ? (
        <TruthTableInput
          variables={truth.variables ?? undefined}
          expression={truth.expression}
          steps={truth.steps ?? undefined}
          mode={truth.mode}
          value={value}
          status={state === "correct" ? "ok" : state === "wrong" ? "bad" : ""}
          onChange={(next: string) => {
            setValue(next);
            if (state !== "busy") setState("idle");
          }}
        />
      ) : (
      <input
        className="all-tasks-check__input"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          if (state !== "busy") setState("idle");
        }}
        placeholder="Ваш ответ"
        aria-label="Ваш ответ"
        maxLength={500}
      />
      )}
      <button type="submit" className="all-tasks-check__btn" disabled={!value.trim() || state === "busy"}>
        Проверить
      </button>
      {state !== "idle" ? (
        <span className={`all-tasks-check__msg all-tasks-check__msg--${state}`} role="status">
          {CHECK_MESSAGES[state]}
          {!authenticated && (state === "correct" || state === "wrong") ? (
            <>
              {" "}
              <Link to="/cabinet/login?next=%2Ftasks" className="all-tasks-check__reg">
                Зарегистрируйтесь
              </Link>
              , чтобы сохранять результаты.
            </>
          ) : null}
        </span>
      ) : null}
    </form>
  );
}
