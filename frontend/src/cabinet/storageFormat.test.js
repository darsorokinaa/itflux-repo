/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { formatStorageBytes, formatUsedOfLimit, quotaExceededMessage } from "./storageFormat";

describe("storageFormat", () => {
  it("uses MB for smaller values and GB without extra decimals", () => {
    expect(formatStorageBytes(284 * 1024 * 1024)).toBe("284 МБ");
    expect(formatStorageBytes(1.24 * 1024 * 1024 * 1024)).toBe("1,24 ГБ");
    expect(formatStorageBytes(4.8 * 1024 * 1024 * 1024)).toBe("4,8 ГБ");
    expect(formatStorageBytes(5 * 1024 * 1024 * 1024)).toBe("5 ГБ");
  });

  it("collapses matching units in used/limit", () => {
    expect(formatUsedOfLimit(4.8 * 1024 * 1024 * 1024, 5 * 1024 * 1024 * 1024)).toBe("4,8 из 5 ГБ");
    expect(formatUsedOfLimit(284 * 1024 * 1024, 5 * 1024 * 1024 * 1024)).toBe("284 МБ из 5 ГБ");
  });

  it("builds quota exceeded copy from bytes", () => {
    expect(quotaExceededMessage({
      storage_used_bytes: 4.8 * 1024 * 1024 * 1024,
      storage_limit_bytes: 5 * 1024 * 1024 * 1024,
    })).toBe("Недостаточно места в хранилище. Использовано 4,8 из 5 ГБ.");
  });
});
