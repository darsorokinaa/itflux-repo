import { useEffect, useState } from "react";

export type FundraiserSnapshot = {
  amountRub: number;
  updatedLabel: string;
  goalRub: number | null;
};

export function formatRub(amount: number): string {
  const whole = Math.trunc(amount);
  const fraction = Math.abs(Math.round((amount - whole) * 100));
  const grouped = String(Math.abs(whole)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const sign = amount < 0 ? "−" : "";
  if (fraction === 0) return `${sign}${grouped} ₽`;
  return `${sign}${grouped},${String(fraction).padStart(2, "0")} ₽`;
}

export function formatFundraiserUpdated(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Moscow",
  }).format(date);
}

export function snapshotFromPayload(data: unknown): FundraiserSnapshot | null {
  if (!data || typeof data !== "object") return null;
  const record = data as {
    amount_rub?: unknown;
    updated_at?: unknown;
    goal_rub?: unknown;
  };
  if (
    typeof record.amount_rub !== "number" ||
    !Number.isFinite(record.amount_rub)
  )
    return null;
  const goal =
    typeof record.goal_rub === "number" &&
    Number.isFinite(record.goal_rub) &&
    record.goal_rub > 0
      ? record.goal_rub
      : null;
  return {
    amountRub: record.amount_rub,
    updatedLabel:
      typeof record.updated_at === "string"
        ? formatFundraiserUpdated(record.updated_at)
        : "",
    goalRub: goal,
  };
}

/** null — суммы нет (запрос ещё идёт, ошибка или ответ без числа). Ноль не подставляем. */
export function useFundraiserSnapshot(): FundraiserSnapshot | null {
  const [snapshot, setSnapshot] = useState<FundraiserSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/fundraiser/current/", { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled) setSnapshot(snapshotFromPayload(data));
      })
      .catch(() => {
        if (!cancelled) setSnapshot(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return snapshot;
}
