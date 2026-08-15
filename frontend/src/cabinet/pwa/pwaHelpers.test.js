import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PUBLIC_KEY = "AAAAAAAAAAAAAAAA";

describe("subscribeWebPush persistence", () => {
  let existingSub;
  let subscribeMock;
  let unsubscribeMock;
  let getSubscriptionMock;

  beforeEach(async () => {
    vi.resetModules();
    unsubscribeMock = vi.fn().mockResolvedValue(true);
    existingSub = {
      endpoint: "https://push.example/same-device",
      toJSON: () => ({
        endpoint: "https://push.example/same-device",
        keys: { p256dh: "p", auth: "a" },
      }),
      unsubscribe: unsubscribeMock,
      options: {},
    };
    getSubscriptionMock = vi.fn().mockResolvedValue(existingSub);
    subscribeMock = vi.fn();
    const registration = {
      pushManager: {
        getSubscription: getSubscriptionMock,
        subscribe: subscribeMock,
      },
      active: {},
    };
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      value: {
        getRegistration: vi.fn().mockResolvedValue(registration),
        ready: Promise.resolve(registration),
      },
    });
    vi.stubGlobal("PushManager", function PushManager() {});
    globalThis.Notification = {
      permission: "granted",
      requestPermission: vi.fn(),
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reuses an existing subscription instead of creating a new endpoint", async () => {
    const { subscribeWebPush } = await import("./pwaHelpers");
    const result = await subscribeWebPush({ publicKey: PUBLIC_KEY });
    expect(result.reused).toBe(true);
    expect(result.subscription.endpoint).toBe("https://push.example/same-device");
    expect(unsubscribeMock).not.toHaveBeenCalled();
    expect(subscribeMock).not.toHaveBeenCalled();
    expect(globalThis.Notification.requestPermission).not.toHaveBeenCalled();
  });

  it("creates a subscription only when none exists", async () => {
    getSubscriptionMock.mockResolvedValue(null);
    subscribeMock.mockResolvedValue({
      toJSON: () => ({
        endpoint: "https://push.example/new",
        keys: { p256dh: "p", auth: "a" },
      }),
    });
    const { subscribeWebPush } = await import("./pwaHelpers");
    const result = await subscribeWebPush({ publicKey: PUBLIC_KEY });
    expect(result.reused).toBe(false);
    expect(result.subscription.endpoint).toBe("https://push.example/new");
    expect(subscribeMock).toHaveBeenCalledTimes(1);
  });
});
