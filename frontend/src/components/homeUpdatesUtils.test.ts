import { describe, expect, it } from "vitest";
import {
  homeUpdatesVisibleCount,
  paginateItems,
  sanitizeUpdateUrl,
  updateLinkText,
  firstUrlInUpdateText,
  resolveUpdateHref,
  HOME_UPDATES_DEFAULT_LINK_TEXT,
} from "./homeUpdatesUtils";

describe("homeUpdatesVisibleCount", () => {
  it("shows 3 cards on desktop", () => {
    expect(homeUpdatesVisibleCount(1440)).toBe(3);
    expect(homeUpdatesVisibleCount(1024)).toBe(3);
  });

  it("shows 2 cards on tablet", () => {
    expect(homeUpdatesVisibleCount(1023)).toBe(2);
    expect(homeUpdatesVisibleCount(768)).toBe(2);
  });

  it("shows 1 card on mobile", () => {
    expect(homeUpdatesVisibleCount(767)).toBe(1);
    expect(homeUpdatesVisibleCount(320)).toBe(1);
  });
});

describe("paginateItems", () => {
  const items = [1, 2, 3, 4, 5, 6, 7];

  it("returns no pages for an empty list", () => {
    expect(paginateItems([], 3)).toEqual([]);
  });

  it("keeps a short list on one page without padding", () => {
    expect(paginateItems([1], 3)).toEqual([[1]]);
    expect(paginateItems([1, 2], 3)).toEqual([[1, 2]]);
    expect(paginateItems([1, 2, 3], 3)).toEqual([[1, 2, 3]]);
  });

  it("pages by groups of three on desktop", () => {
    expect(paginateItems(items.slice(0, 4), 3)).toEqual([[1, 2, 3], [4]]);
    expect(paginateItems(items.slice(0, 6), 3)).toEqual([[1, 2, 3], [4, 5, 6]]);
    expect(paginateItems(items, 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
  });

  it("pages by two on tablet and by one on mobile", () => {
    expect(paginateItems(items, 2)).toEqual([[1, 2], [3, 4], [5, 6], [7]]);
    expect(paginateItems(items.slice(0, 3), 1)).toEqual([[1], [2], [3]]);
  });
});

describe("sanitizeUpdateUrl", () => {
  it("keeps site paths and http(s) urls", () => {
    expect(sanitizeUpdateUrl("/cabinet")).toBe("/cabinet");
    expect(sanitizeUpdateUrl("https://itflux.ru/cabinet")).toBe("https://itflux.ru/cabinet");
    expect(sanitizeUpdateUrl("cabinet")).toBe("/cabinet");
    expect(sanitizeUpdateUrl("www.example.com/page")).toBe("https://www.example.com/page");
  });

  it("rejects unsafe or empty values", () => {
    expect(sanitizeUpdateUrl("")).toBe("");
    expect(sanitizeUpdateUrl("javascript:alert(1)")).toBe("");
    expect(sanitizeUpdateUrl("//evil.example")).toBe("");
  });
});

describe("updateLinkText", () => {
  it("falls back to the default label", () => {
    expect(updateLinkText("")).toBe(HOME_UPDATES_DEFAULT_LINK_TEXT);
    expect(updateLinkText("В кабинет")).toBe("В кабинет");
  });
});

describe("resolveUpdateHref", () => {
  it("prefers the url field and otherwise takes a url from the description", () => {
    expect(firstUrlInUpdateText("Смотрите https://itflux.ru/cabinet завтра")).toBe("https://itflux.ru/cabinet");
    expect(resolveUpdateHref({ url: "/lessons", description: "https://example.com" })).toBe("/lessons");
    expect(resolveUpdateHref({ url: "", description: "Открыть /cabinet" })).toBe("/cabinet");
  });
});
