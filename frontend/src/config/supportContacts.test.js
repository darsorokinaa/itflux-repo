/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
  getSupportContacts,
  SUPPORT_EMAIL_DEFAULT,
  SUPPORT_TELEGRAM_DEFAULT,
} from "./supportContacts";
import {
  TEACHERS_TELEGRAM_CHAT_URL,
  TEACHERS_VK_URL,
} from "./teacherLinks";

describe("getSupportContacts defaults", () => {
  it("uses personal telegram, email and community chat", () => {
    const contacts = getSupportContacts();
    expect(contacts.telegram?.username).toBe(SUPPORT_TELEGRAM_DEFAULT);
    expect(contacts.telegram?.display).toBe("@dariyasorokinaa");
    expect(contacts.telegram?.url).toBe("https://t.me/dariyasorokinaa");
    expect(contacts.email).toBe(SUPPORT_EMAIL_DEFAULT);
    expect(contacts.vk?.url).toBe(TEACHERS_VK_URL);
    expect(contacts.social).toEqual([
      { id: "telegram-chat", label: "Telegram", url: TEACHERS_TELEGRAM_CHAT_URL },
    ]);
    expect(TEACHERS_TELEGRAM_CHAT_URL).toBe("https://t.me/c/itfluxchat/262");
  });

  it("does not include secret-like fields or instagram by default", () => {
    const contacts = getSupportContacts();
    const serialized = JSON.stringify(contacts).toLowerCase();
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("bot_token");
    expect(serialized).not.toContain("instagram");
  });
});
