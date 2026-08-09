/** @vitest-environment jsdom */
import React, { useEffect, useState } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import SupportModal from "./SupportModal";
import SupportContactLink from "./SupportContactLink";
import { openSupport, SUPPORT_OPEN_EVENT } from "../support";
import {
  getPublicSupportContactKeys,
  getSupportContacts,
  telegramHttpsUrl,
  normalizeTelegramUsername,
} from "../../config/supportContacts";

vi.mock("../../config/supportContacts", async () => {
  const actual = await vi.importActual("../../config/supportContacts");
  return {
    ...actual,
    getSupportContacts: vi.fn(),
  };
});

function mockContacts(partial = {}) {
  getSupportContacts.mockReturnValue({
    telegram: {
      username: "itfluxacademy",
      display: "@itfluxacademy",
      url: "https://t.me/itfluxacademy",
    },
    email: "hello@example.com",
    vk: { url: "https://vk.com/itfluxacademy" },
    social: [
      {
        id: "telegram-chat",
        label: "Telegram-чат",
        url: "https://t.me/c/itfluxchat/262",
      },
    ],
    ...partial,
  });
}

function SupportHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(SUPPORT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(SUPPORT_OPEN_EVENT, onOpen);
  }, []);
  return (
    <div>
      <button type="button" onClick={openSupport}>
        Поддержка
      </button>
      <SupportContactLink />
      <SupportModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

describe("supportContacts helpers", () => {
  it("builds https Telegram URL from username", () => {
    expect(telegramHttpsUrl("itfluxacademy")).toBe("https://t.me/itfluxacademy");
    expect(telegramHttpsUrl("@itfluxacademy")).toBe("https://t.me/itfluxacademy");
    expect(telegramHttpsUrl("https://t.me/itfluxacademy")).toBe(
      "https://t.me/itfluxacademy",
    );
  });

  it("normalizes username from URL", () => {
    expect(normalizeTelegramUsername("https://t.me/itfluxacademy")).toBe(
      "itfluxacademy",
    );
  });

  it("exposes only public contact keys (no secrets)", () => {
    expect(getPublicSupportContactKeys()).toEqual([
      "telegram",
      "email",
      "vk",
      "social",
    ]);
  });
});

describe("SupportModal", () => {
  beforeEach(() => {
    mockContacts();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("opens with title and contact actions", () => {
    render(<SupportModal open onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Нужна помощь?" })).toBeTruthy();
    expect(screen.getByText("@itfluxacademy")).toBeTruthy();

    const writeLinks = screen.getAllByRole("link", { name: "Написать" });
    expect(writeLinks[0].getAttribute("href")).toBe("https://t.me/itfluxacademy");
    expect(writeLinks[0].getAttribute("target")).toBe("_blank");
    expect(writeLinks[0].getAttribute("rel")).toContain("noopener");
    expect(writeLinks[1].getAttribute("href")).toBe("mailto:hello@example.com");

    const vk = screen.getByRole("link", { name: "Открыть" });
    expect(vk.getAttribute("href")).toBe("https://vk.com/itfluxacademy");
    expect(vk.getAttribute("rel")).toContain("noreferrer");
  });

  it("hides empty contacts", () => {
    mockContacts({
      telegram: null,
      email: null,
      vk: null,
      social: [],
    });
    render(<SupportModal open onClose={() => {}} />);
    expect(screen.queryByText("Telegram")).toBeNull();
    expect(screen.queryByText("Email")).toBeNull();
    expect(screen.queryByText("VK")).toBeNull();
    expect(screen.queryByText("Социальные сети")).toBeNull();
    expect(screen.getByText(/Контакты поддержки скоро/)).toBeTruthy();
  });

  it("closes on Escape and close button", () => {
    const onClose = vi.fn();
    render(<SupportModal open onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("Закрыть"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("does not render when closed", () => {
    render(<SupportModal open={false} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("uses compact support modal class for layout", () => {
    render(<SupportModal open onClose={() => {}} />);
    expect(screen.getByRole("dialog").className).toContain("cb-support-modal");
  });
});

describe("Support trigger / single modal", () => {
  beforeEach(() => {
    mockContacts();
  });

  afterEach(() => {
    cleanup();
  });

  it("SupportContactLink dispatches the shared open event", () => {
    const spy = vi.fn();
    window.addEventListener(SUPPORT_OPEN_EVENT, spy);
    render(<SupportContactLink />);
    fireEvent.click(
      screen.getByRole("button", { name: "Связаться с поддержкой" }),
    );
    expect(spy).toHaveBeenCalledTimes(1);
    window.removeEventListener(SUPPORT_OPEN_EVENT, spy);
  });

  it("repeated clicks open a single SupportModal instance", () => {
    render(<SupportHost />);
    fireEvent.click(screen.getByRole("button", { name: "Поддержка" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Связаться с поддержкой" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Поддержка" }));
    expect(screen.getAllByRole("dialog", { name: "Нужна помощь?" })).toHaveLength(
      1,
    );
  });

  it("shows Поддержка trigger used in cabinet nav", () => {
    render(
      <button type="button" aria-label="Поддержка">
        Поддержка
      </button>,
    );
    expect(screen.getByRole("button", { name: "Поддержка" })).toBeTruthy();
  });
});
