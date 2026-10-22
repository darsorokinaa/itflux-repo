/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { getSupportContacts, getPublicSupportContactKeys } from "./supportContacts";
import { MAX_CHANNEL_URL, MAX_CHANNEL_NAME } from "./teacherLinks";

describe("r96 MAX channel", () => {
  it("exposes the MAX channel link", () => {
    expect(MAX_CHANNEL_URL).toBe("https://max.ru/channel_itfluxacademy");
    expect(MAX_CHANNEL_NAME).toBe("Цифровой поток - онлайн-академия IT-технологий");
    const c = getSupportContacts();
    expect(c.max).toEqual({ url: MAX_CHANNEL_URL, name: MAX_CHANNEL_NAME });
    expect(c.social.map((s) => s.url)).not.toContain(MAX_CHANNEL_URL);
    expect(getPublicSupportContactKeys()).toContain("max");
  });
});
