import { useEffect, useState } from "react";

/** Тариф из публичного API /api/cabinet/pricing/plans/ (TariffPlan в БД). */
export type PublicPlan = {
  slug: string;
  name: string;
  price_month: string;
  price_year: string;
  currency: string;
  is_recommended?: boolean;
  badge_text?: string;
  limits?: { students?: number | null };
};

/** r103: цены на лендинге — только из API, без захардкоженных запасных значений. */
export function useTariffPlans() {
  const [plans, setPlans] = useState<PublicPlan[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/cabinet/pricing/plans/", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data?.plans)) setPlans(data.plans);
        else setFailed(true);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);
  return { plans, failed };
}

export const fmtRub = (v: string | number | null | undefined) =>
  Math.round(Number(v) || 0).toLocaleString("ru-RU").replace(/\u00a0/g, " ");

/** Скидка за год в процентах относительно 12 × помесячной оплаты. */
export function yearDiscountPercent(p: PublicPlan): number | null {
  const m = Number(p.price_month);
  const y = Number(p.price_year);
  if (!(m > 0) || !(y > 0) || y >= m * 12) return null;
  return Math.round((1 - y / (m * 12)) * 100);
}
