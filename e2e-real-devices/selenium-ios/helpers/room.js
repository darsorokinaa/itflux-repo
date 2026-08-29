const { SELECTORS, xpathButton, xpathTab, displayed, waitFor, FlowError } = require("./dom");
const { writeJson, screenshot, redactSecrets } = require("./artifacts");
const { executeJson } = require("./execute-json");

async function jitsiIframeCount(browser) {
  const frames = await browser.$$(SELECTORS.jitsiIframe);
  return frames.length;
}

async function joinError(browser) {
  const title = await browser.$(`xpath://*[normalize-space()=${JSON.stringify(SELECTORS.roomJoinError)}]`);
  if (!(await displayed(title))) return null;
  const subtitleEl = await browser.$(SELECTORS.roomJoinErrorSubtitle);
  const subtitle = await displayed(subtitleEl) ? await subtitleEl.getText() : "";
  return { title: SELECTORS.roomJoinError, subtitle };
}

async function callAvailable(browser) {
  const tab = await browser.$(xpathTab(SELECTORS.tabCall));
  if (await displayed(tab)) return true;
  const expand = await browser.$(xpathButton("На весь экран"));
  return displayed(expand);
}

async function materialsAvailable(browser) {
  const tab = await browser.$(xpathTab(SELECTORS.tabMaterials));
  if (await displayed(tab)) return true;
  const header = await browser.$(
    `xpath://button[contains(normalize-space(), ${JSON.stringify(SELECTORS.headerMaterials)})]`,
  );
  return displayed(header);
}

async function jitsiContainerVisible(browser) {
  const el = await browser.$(SELECTORS.jitsiContainer);
  return displayed(el);
}

async function isLiveRoomUi(browser) {
  const err = await joinError(browser);
  if (err) return false;
  const root = await browser.$(SELECTORS.roomRoot);
  if (!(await displayed(root))) return false;
  const iframeCount = await jitsiIframeCount(browser);
  if (iframeCount > 1) return false;
  const call = await callAvailable(browser);
  const materials = await materialsAvailable(browser);
  const container = await jitsiContainerVisible(browser);
  const tablist = await browser.$(
    `xpath://*[@role="tablist" and @aria-label=${JSON.stringify(SELECTORS.screenModeTablist)}]`,
  );
  const tabs = (await displayed(tablist)) || (call && materials);
  return Boolean(tabs && (container || iframeCount === 1) && call && materials);
}

async function openLessonRoom(browser, lessonRoomUrl) {
  await browser.url(lessonRoomUrl);
  const root = await browser.$(SELECTORS.roomRoot);
  await root.waitForDisplayed({ timeout: 60_000 });
  const start = await browser.$(xpathButton(SELECTORS.startLesson));
  if (await displayed(start)) await start.click();
}

async function clickWithoutCamera(browser) {
  const btn = await browser.$(xpathButton(SELECTORS.cameraWithout));
  const shown = await waitFor(browser, async () => {
    if (await displayed(btn)) return "camera";
    if (await isLiveRoomUi(browser)) return "already-live";
    return false;
  }, { timeoutMs: 60_000, message: "Neither «Без камеры» nor live room UI appeared" });
  if (shown === "already-live") return { clicked: false, alreadyLive: true };
  await btn.click();
  return { clicked: true, alreadyLive: false };
}

async function waitForSuccessfulJoin(browser, { timeoutMs = 60_000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const err = await joinError(browser);
    if (err) {
      throw new FlowError(
        "Jitsi did not join after permission",
        `${err.title}${err.subtitle ? ` — ${err.subtitle}` : ""}`,
      );
    }
    if (await isLiveRoomUi(browser)) {
      const iframeCount = await jitsiIframeCount(browser);
      if (iframeCount > 1) {
        throw new FlowError("Jitsi did not join after permission", `Jitsi iframe count ${iframeCount} > 1`);
      }
      return { iframeCount, waitedMs: Date.now() - started };
    }
    await browser.pause(1_000);
  }
  throw new FlowError(
    "Jitsi did not join after permission",
    "Jitsi conference join did not reach full room UI after microphone Allow",
  );
}

async function switchToCall(browser) {
  const tab = await browser.$(xpathTab(SELECTORS.tabCall));
  if (await displayed(tab)) {
    await tab.click();
    return;
  }
  const expand = await browser.$(xpathButton("На весь экран"));
  if (await displayed(expand)) await expand.click();
}

function materialsTabXpath() {
  return `xpath://*[@role="tablist" and @aria-label=${JSON.stringify(SELECTORS.screenModeTablist)}]//*[@role="tab" and contains(normalize-space(), ${JSON.stringify(SELECTORS.tabMaterials)})]`;
}

async function captureMaterialsDom(browser) {
  const raw = await executeJson(browser, () => {
    function attr(el, name) {
      if (!el || !el.getAttribute) return "";
      const value = el.getAttribute(name);
      return value == null ? "" : String(value);
    }
    function shown(el) {
      return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
    }
    function styleOf(el) {
      if (!el) return null;
      const cs = window.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        display: String(cs.display || ""),
        visibility: String(cs.visibility || ""),
        overflow: String(cs.overflow || ""),
        overflowX: String(cs.overflowX || ""),
        width: String(cs.width || ""),
        height: String(cs.height || ""),
        rect: {
          x: Number(r.x),
          y: Number(r.y),
          width: Number(r.width),
          height: Number(r.height),
        },
        inDom: true,
      };
    }
    const page = document.querySelector(".video-lesson-page");
    const aside = document.querySelector("aside.video-lesson-aside, aside[aria-label='Материалы урока']");
    const complementary = document.querySelector('[role="complementary"][aria-label="Материалы урока"]');
    const tablist = document.querySelector('[role="tablist"][aria-label="Режим экрана"]');
    const tabs = [];
    if (tablist) {
      const tabNodes = tablist.querySelectorAll('[role="tab"]');
      for (let i = 0; i < tabNodes.length; i += 1) {
        const el = tabNodes[i];
        tabs.push({
          text: String(el.innerText || "").trim().slice(0, 80),
          ariaSelected: attr(el, "aria-selected"),
          className: attr(el, "class"),
          displayed: shown(el),
        });
      }
    }
    const visibleButtons = [];
    const buttons = document.querySelectorAll("button");
    for (let i = 0; i < buttons.length && visibleButtons.length < 40; i += 1) {
      const el = buttons[i];
      if (!shown(el)) continue;
      const text = String(el.innerText || attr(el, "aria-label")).trim().slice(0, 80);
      if (text) visibleButtons.push(text);
    }
    function textMatches(needle) {
      const out = [];
      const nodes = document.querySelectorAll("button, [role='tab'], h2, a, span");
      for (let i = 0; i < nodes.length && out.length < 12; i += 1) {
        const el = nodes[i];
        const text = String(el.innerText || "");
        if (text.indexOf(needle) === -1) continue;
        out.push({
          tag: String(el.tagName || ""),
          role: attr(el, "role"),
          text: text.trim().slice(0, 80),
          displayed: shown(el),
        });
      }
      return out;
    }
    let href = "";
    try { href = String(window.location.href || ""); } catch (e) { href = ""; }
    let bodyText = "";
    try {
      bodyText = document.body && document.body.innerText ? String(document.body.innerText).slice(0, 4000) : "";
    } catch (e) { bodyText = ""; }
    const report = {
      url: href,
      pageClassName: attr(page, "class"),
      mobileMaterialsClass: attr(page, "class").indexOf("video-lesson-page--mobile-materials") !== -1,
      compactClass: attr(page, "class").indexOf("video-lesson-page--compact") !== -1,
      asideClass: attr(page, "class").indexOf("video-lesson-page--aside") !== -1,
      tabs: tabs,
      materialsTabSelected: tabs.some(function (t) {
        return t.text.indexOf("Материалы") !== -1 && (t.ariaSelected === "true" || /\bis-active\b/.test(t.className));
      }),
      asidePresent: !!aside,
      complementaryAttrPresent: !!complementary,
      asideStyle: styleOf(aside),
      complementaryStyle: styleOf(complementary),
      visibleButtons: visibleButtons,
      materialsText: textMatches("Материалы"),
      openText: textMatches("Открыть"),
      iframeCount: document.querySelectorAll("#jitsi-container iframe").length,
      boardIframeCount: document.querySelectorAll('iframe[src*="/cabinet/boards/"]').length,
      bodyInnerText: bodyText,
      pageOuterHtml: page ? String(page.outerHTML).slice(0, 20000) : "",
    };
    return JSON.stringify(report);
  }, "materials-dom");
  return JSON.parse(redactSecrets(JSON.stringify(raw)));
}

function classifyMaterialsClick(before, after) {
  const selected = Boolean(after.materialsTabSelected);
  const panelShown = Boolean(
    after.asideStyle
    && after.asideStyle.display !== "none"
    && after.asideStyle.visibility !== "hidden"
    && Number(after.asideStyle.rect && after.asideStyle.rect.width) > 1
    && Number(after.asideStyle.rect && after.asideStyle.rect.height) > 1,
  );
  const openVisible = (after.openText || []).some((el) => el.displayed && el.text.includes("Открыть"));
  if (selected && (panelShown || openVisible || after.mobileMaterialsClass)) {
    return {
      outcome: "B",
      label: "tab active and mobile materials UI present",
      classification: "MATERIALS = SELECTOR BUG",
    };
  }
  if (selected && after.asidePresent && !panelShown) {
    return {
      outcome: "A-hidden",
      label: "tab active but panel hidden by CSS / zero box",
      classification: "MATERIALS = PRODUCT MOBILE BUG",
    };
  }
  if (selected) {
    return {
      outcome: "A",
      label: "tab became selected",
      classification: "MATERIALS = SELECTOR BUG",
    };
  }
  const sameTabs = JSON.stringify(before.tabs) === JSON.stringify(after.tabs);
  return {
    outcome: "C",
    label: sameTabs ? "click did not change tab state" : "tab not selected after click",
    classification: "MATERIALS = PRODUCT MOBILE BUG",
  };
}

async function clickMaterialsTab(browser) {
  const tab = await browser.$(materialsTabXpath());
  if (await displayed(tab)) {
    await tab.click();
    return { clicked: "mobile-tablist Материалы", selector: materialsTabXpath() };
  }
  const anyTab = await browser.$(xpathTab(SELECTORS.tabMaterials));
  if (await displayed(anyTab)) {
    await anyTab.click();
    return { clicked: "role=tab Материалы", selector: xpathTab(SELECTORS.tabMaterials) };
  }
  throw new FlowError("MATERIALS = PRODUCT MOBILE BUG", "No visible «Материалы» tab to click");
}

async function switchToMaterials(browser) {
  const before = await captureMaterialsDom(browser);
  writeJson("materials-before.json", before);
  await screenshot(browser, "06a-materials-before-click");

  const click = await clickMaterialsTab(browser);
  await browser.pause(600);

  const after = await captureMaterialsDom(browser);
  after.clickedControl = click;
  const verdict = classifyMaterialsClick(before, after);
  after.verdict = verdict;
  writeJson("materials-after.json", after);
  await screenshot(browser, "06b-materials-after-click");

  if (verdict.classification === "MATERIALS = PRODUCT MOBILE BUG") {
    throw new FlowError(
      verdict.classification,
      `${verdict.label}. asidePresent=${after.asidePresent} complementaryAttr=${after.complementaryAttrPresent} `
      + `display=${after.asideStyle && after.asideStyle.display} `
      + `rect=${JSON.stringify(after.asideStyle && after.asideStyle.rect)} `
      + `pageClass=${after.pageClassName}`,
    );
  }

  await waitFor(browser, async () => {
    const snap = await captureMaterialsDom(browser);
    const panelShown = Boolean(
      snap.asideStyle
      && snap.asideStyle.display !== "none"
      && Number(snap.asideStyle.rect && snap.asideStyle.rect.width) > 1
      && Number(snap.asideStyle.rect && snap.asideStyle.rect.height) > 1,
    );
    const openVisible = (snap.openText || []).some((el) => el.displayed);
    return Boolean(snap.materialsTabSelected && (panelShown || openVisible || snap.mobileMaterialsClass));
  }, {
    timeoutMs: 15_000,
    message: "Materials tab clicked but mobile materials UI did not appear",
  });

  return { click, verdict };
}

async function assertMaterialsUsable(browser) {
  const switched = await switchToMaterials(browser);
  const overflow = await executeJson(browser, () => {
    const el = document.querySelector("aside.video-lesson-aside, aside[aria-label='Материалы урока']");
    if (!el) {
      return JSON.stringify({ scrollWidth: 0, clientWidth: 0, missing: true, display: "", visibility: "", width: 0, height: 0 });
    }
    const cs = window.getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return JSON.stringify({
      missing: false,
      scrollWidth: Number(el.scrollWidth),
      clientWidth: Number(el.clientWidth),
      display: String(cs.display || ""),
      visibility: String(cs.visibility || ""),
      width: Number(r.width),
      height: Number(r.height),
    });
  }, "materials-overflow");
  if (overflow.missing) {
    throw new FlowError("MATERIALS = PRODUCT MOBILE BUG", "aside.video-lesson-aside not in DOM after Materials tab");
  }
  if (overflow.display === "none" || overflow.width < 1 || overflow.height < 1) {
    throw new FlowError(
      "MATERIALS = PRODUCT MOBILE BUG",
      `materials panel hidden display=${overflow.display} ${overflow.width}x${overflow.height}`,
    );
  }
  if (overflow.scrollWidth > overflow.clientWidth + 2) {
    throw new FlowError(
      "MATERIALS",
      `materials panel horizontal overflow scrollWidth=${overflow.scrollWidth} clientWidth=${overflow.clientWidth}`,
    );
  }
  const openBtn = await browser.$(xpathButton(SELECTORS.boardOpenButton));
  if (!(await displayed(openBtn))) {
    throw new FlowError("MATERIALS", "Материалы: «Открыть» is not visible");
  }
  return switched;
}

async function captureViewport(browser) {
  const size = await browser.getWindowSize().catch(() => ({ width: 0, height: 0 }));
  let box = { scrollWidth: 0, clientWidth: 0 };
  try {
    box = await executeJson(browser, () => JSON.stringify({
      scrollWidth: Number(document.documentElement.scrollWidth),
      clientWidth: Number(document.documentElement.clientWidth),
    }), "page-overflow");
  } catch {
    box = { scrollWidth: 0, clientWidth: 0 };
  }
  const width = Number(size.width) || 0;
  const height = Number(size.height) || 0;
  const scrollWidth = Number(box.scrollWidth) || 0;
  const clientWidth = Number(box.clientWidth) || width;
  return {
    width,
    height,
    scrollWidth,
    clientWidth,
    overflowOk: scrollWidth <= clientWidth + 2,
  };
}

async function assertNoHorizontalOverflow(browser) {
  const viewport = await captureViewport(browser);
  if (!viewport.overflowOk) {
    throw new FlowError(
      "LAYOUT",
      `horizontal overflow scrollWidth=${viewport.scrollWidth} clientWidth=${viewport.clientWidth} viewport=${viewport.width}x${viewport.height}`,
      { productFailure: true },
    );
  }
  return viewport;
}

async function assertClickableRoom(browser) {
  const root = await browser.$(SELECTORS.roomRoot);
  if (!(await displayed(root))) {
    throw new FlowError("ROOM", "room root not visible");
  }
  const count = await jitsiIframeCount(browser);
  if (count > 1) {
    throw new FlowError("Jitsi did not join after permission", `Jitsi iframe count ${count} > 1`);
  }
}

module.exports = {
  jitsiIframeCount,
  joinError,
  isLiveRoomUi,
  openLessonRoom,
  clickWithoutCamera,
  waitForSuccessfulJoin,
  switchToCall,
  switchToMaterials,
  assertMaterialsUsable,
  assertNoHorizontalOverflow,
  assertClickableRoom,
  callAvailable,
  materialsAvailable,
  captureMaterialsDom,
  captureViewport,
  classifyMaterialsClick,
  clickMaterialsTab,
};
