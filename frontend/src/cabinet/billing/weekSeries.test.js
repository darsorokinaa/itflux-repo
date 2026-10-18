import { describe, expect, it } from "vitest";
import { buildWeekSeries, zonedDateParts } from "./weekSeries";

describe("weekSeries (r74)", () => {
  it("оплата 1-го числа 12:00 МСК остаётся в этом месяце и в зоне Калининграда", () => {
    const tx = { occurred_at: "2026-10-01T09:00:00Z", transaction_type: "payment", amount: "1800.00" };
    const s = buildWeekSeries([tx], new Date(2026, 9, 1), "Europe/Kaliningrad");
    expect(s[0].received).toBe(1800);
  });

  it("старая оплата 00:00 МСК для Калининграда — это 30-е прошлого месяца", () => {
    const p = zonedDateParts("2026-09-30T21:00:00Z", "Europe/Kaliningrad");
    expect(p).toEqual({ year: 2026, month: 8, day: 30 });
    const p2 = zonedDateParts("2026-09-30T21:00:00Z", "Europe/Moscow");
    expect(p2).toEqual({ year: 2026, month: 9, day: 1 });
  });

  it("списание из абонемента входит в «начислено», сторно и отменённые не учитываются", () => {
    const txs = [
      { occurred_at: "2026-10-10T10:00:00Z", transaction_type: "package_consumption", amount: "1400.00" },
      { occurred_at: "2026-10-10T10:00:00Z", transaction_type: "charge", amount: "1500.00" },
      { occurred_at: "2026-10-10T11:00:00Z", transaction_type: "charge", amount: "-1500.00", is_reversal: true },
      { occurred_at: "2026-10-10T10:00:00Z", transaction_type: "charge", amount: "900.00", is_reversed: true },
    ];
    const s = buildWeekSeries(txs, new Date(2026, 9, 1), "Europe/Moscow");
    expect(s[1].charged).toBe(2900);
  });
});
