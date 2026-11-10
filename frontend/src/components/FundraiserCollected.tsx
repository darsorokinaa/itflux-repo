import type { FundraiserSnapshot } from "../pages/fundraiserAmount";
import { formatRub } from "../pages/fundraiserAmount";

export default function FundraiserCollected({ snapshot }: { snapshot: FundraiserSnapshot | null }) {
  const goal = snapshot?.goalRub ?? null;
  const ratio = snapshot && goal ? Math.min(100, Math.max(0, (snapshot.amountRub / goal) * 100)) : 0;
  const updated = snapshot?.updatedLabel ? ` · обновлено ${snapshot.updatedLabel}` : "";

  return (
    <>
      {snapshot ? (
        <>
          <p className="xmas-fund-label">Уже собрано</p>
          <p className="xmas-fund-amount">{formatRub(snapshot.amountRub)}</p>
          <div
            className="xmas-fund-bar"
            role="progressbar"
            aria-label={goal ? "Сумма сбора" : "Сумма сбора, цель не задана"}
            aria-valuemin={goal ? 0 : undefined}
            aria-valuemax={goal ? 100 : undefined}
            aria-valuenow={goal ? Math.round(ratio) : undefined}
          >
            {goal ? <span className="xmas-fund-bar__fill" style={{ width: `${ratio}%` }} /> : null}
          </div>
        </>
      ) : null}
      <p className="xmas-fund-cap">Подписки на платформе, донаты и переводы{updated}</p>
    </>
  );
}
