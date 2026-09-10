const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  isAllowedDesktopPermission,
  isSafeExternalHttpsURL,
  isTrustedDesktopURL,
} = require("./trustedOrigins.cjs");

describe("trusted desktop origins", () => {
  it("allows only exact production origins", () => {
    assert.equal(isTrustedDesktopURL("https://itflux-academy.ru/cabinet/meetings/abc"), true);
    assert.equal(isTrustedDesktopURL("https://lesson.itflux-academy.ru/"), true);
  });

  it("rejects www, wildcards, extra ports, and credentials", () => {
    assert.equal(isTrustedDesktopURL("https://www.itflux-academy.ru/cabinet/"), false);
    assert.equal(isTrustedDesktopURL("https://hello.itflux-academy.ru/"), false);
    assert.equal(isTrustedDesktopURL("https://evil.itflux-academy.ru/"), false);
    assert.equal(isTrustedDesktopURL("https://itflux-academy.ru:444/cabinet/"), false);
    assert.equal(isTrustedDesktopURL("https://user:pass@itflux-academy.ru/cabinet/"), false);
  });

  it("rejects untrusted schemes and hosts", () => {
    assert.equal(isTrustedDesktopURL("http://itflux-academy.ru/cabinet/"), false);
    assert.equal(isTrustedDesktopURL("file:///etc/passwd"), false);
    assert.equal(isTrustedDesktopURL("javascript:alert(1)"), false);
    assert.equal(isTrustedDesktopURL("data:text/html,hi"), false);
    assert.equal(isTrustedDesktopURL("https://evil.example/"), false);
  });

  it("allows localhost only when explicitly opted in", () => {
    assert.equal(isTrustedDesktopURL("http://localhost:5001/cabinet/"), false);
    assert.equal(isTrustedDesktopURL("http://127.0.0.1:5001/", { allowHttpLocalhost: true }), true);
  });
});

describe("external https policy", () => {
  it("allows ordinary https URLs", () => {
    assert.equal(isSafeExternalHttpsURL("https://itflux-academy.ru/cabinet/"), true);
    assert.equal(isSafeExternalHttpsURL("https://example.com/docs"), true);
  });

  it("rejects non-https schemes and credentials", () => {
    assert.equal(isSafeExternalHttpsURL("http://itflux-academy.ru/"), false);
    assert.equal(isSafeExternalHttpsURL("file:///tmp/x"), false);
    assert.equal(isSafeExternalHttpsURL("javascript:alert(1)"), false);
    assert.equal(isSafeExternalHttpsURL("data:text/html,hi"), false);
    assert.equal(isSafeExternalHttpsURL("slack://channel"), false);
    assert.equal(isSafeExternalHttpsURL("https://user:pass@example.com/"), false);
  });
});

describe("desktop permission policy", () => {
  it("allows required permissions only for trusted requesting origins", () => {
    assert.equal(isAllowedDesktopPermission("media", "https://itflux-academy.ru/cabinet/meetings/1"), true);
    assert.equal(isAllowedDesktopPermission("display-capture", "https://lesson.itflux-academy.ru/Room"), true);
    assert.equal(isAllowedDesktopPermission("fullscreen", "https://lesson.itflux-academy.ru/Room"), true);
  });

  it("denies clipboard, notifications, and untrusted origins", () => {
    assert.equal(isAllowedDesktopPermission("clipboard-sanitized-write", "https://itflux-academy.ru/"), false);
    assert.equal(isAllowedDesktopPermission("clipboard-read", "https://itflux-academy.ru/"), false);
    assert.equal(isAllowedDesktopPermission("notifications", "https://itflux-academy.ru/"), false);
    assert.equal(isAllowedDesktopPermission("media", "https://evil.example/"), false);
    assert.equal(isAllowedDesktopPermission("media", "https://hello.itflux-academy.ru/"), false);
    assert.equal(isAllowedDesktopPermission("media", ""), false);
  });
});
