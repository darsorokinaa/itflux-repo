const test = require("node:test");
const assert = require("node:assert/strict");
const { SELECTORS, xpathButton } = require("./dom");
const { dismissCookieBanner, isClickIntercepted } = require("./auth");

test("cookie banner selectors match production Layout.jsx", () => {
  assert.equal(SELECTORS.cookieBanner, ".cookie-banner");
  assert.equal(SELECTORS.cookieBannerText, ".cookie-banner-text");
  assert.equal(SELECTORS.cookieAcceptBtn, ".cookie-banner-btn");
  assert.equal(SELECTORS.cookieAccept, "Принять");
});

test("click intercepted overlay on password is treated as login infra", () => {
  const err = new Error(
    'element click intercepted: Element <input autocomplete="current-password" required="" type="password" value=""> is not clickable at point. Other element would receive the click: <p class="cookie-banner-text">...</p>',
  );
  assert.equal(isClickIntercepted(err), true);
});

test("dismissCookieBanner clicks .cookie-banner-btn and waits until overlay is gone", async () => {
  let bannerVisible = true;
  let clicks = 0;
  const banner = { isDisplayed: async () => bannerVisible };
  const btn = {
    isDisplayed: async () => bannerVisible,
    waitForClickable: async () => {},
    click: async () => {
      clicks += 1;
      bannerVisible = false;
    },
  };
  const missing = { isDisplayed: async () => false };
  const browser = {
    $: async (sel) => {
      if (sel === SELECTORS.cookieBanner) return banner;
      if (sel === SELECTORS.cookieAcceptBtn) return btn;
      if (sel === xpathButton(SELECTORS.cookieAccept)) return missing;
      return missing;
    },
  };
  const result = await dismissCookieBanner(browser);
  assert.equal(result.dismissed, true);
  assert.equal(clicks, 1);
});

test("dismissCookieBanner is a no-op when banner is not displayed", async () => {
  const hidden = { isDisplayed: async () => false };
  const browser = {
    $: async () => hidden,
  };
  const result = await dismissCookieBanner(browser);
  assert.equal(result.dismissed, false);
  assert.equal(result.attempts, 0);
});
