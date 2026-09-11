import { chromium, webkit } from "../../e2e-real-devices/node_modules/playwright/index.mjs";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const BASE = process.env.SMOKE_BASE_URL || "http://127.0.0.1:5001";
const LOGIN = process.env.SMOKE_LOGIN || "";
const PASSWORD = process.env.SMOKE_PASSWORD || "";
if (!LOGIN || !PASSWORD) {
  console.error("Set SMOKE_LOGIN and SMOKE_PASSWORD");
  process.exit(1);
}
const OUT_DIR = "/tmp/plan-editor-smoke";
const RESULTS = [];

fs.mkdirSync(OUT_DIR, { recursive: true });

function record(id, status, details) {
  RESULTS.push({ id, status, details });
  console.log(`\n[${status}] ${id}\n${details}\n`);
}

async function dismissNoise(page) {
  const cookie = page.getByRole("button", { name: "Принять" });
  if (await cookie.isVisible().catch(() => false)) {
    await cookie.click();
    await page.waitForTimeout(200);
  }
}

async function login(page) {
  await page.goto(`${BASE}/cabinet/login`, { waitUntil: "domcontentloaded" });
  await dismissNoise(page);
  await page.getByLabel("Email или логин").fill(LOGIN);
  await page.getByLabel("Пароль").fill(PASSWORD);
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL((url) => !String(url).includes("/cabinet/login"), { timeout: 20000 });
  await dismissNoise(page);
}

async function savePlan(page, mobile) {
  await dismissNoise(page);
  if (mobile) {
    await page.locator(".cb-pe-header__save").evaluate((el) => el.click());
  } else {
    await page.getByRole("button", { name: "Сохранить план" }).click();
  }
  await page.waitForURL(/\/cabinet\/plans\/\d+\/edit/, { timeout: 25000 });
  await page.waitForTimeout(500);
}

function addLessonButton(page) {
  return page.locator(".cb-pe-header").getByRole("button", { name: "Добавить урок" });
}

async function openNewPlan(page) {
  await page.goto(`${BASE}/cabinet/plans/new`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Название плана").waitFor({ timeout: 20000 });
}

function field(page, label) {
  return page.locator(".cb-pe-field").filter({ has: page.locator("span", { hasText: new RegExp(`^${label}$`) }) }).locator("input, textarea").first();
}

function sessionCard(page, index) {
  return page.locator(`[data-plan-index="${index}"]`);
}

async function expandSession(page, index) {
  const card = sessionCard(page, index);
  if (await card.locator(".cb-pe-session__body").count()) return;
  await card.locator(".cb-pe-session__summary").click();
  await card.locator(".cb-pe-session__body").waitFor();
}

async function collapseSession(page, index) {
  const card = sessionCard(page, index);
  if (!(await card.locator(".cb-pe-session__body").count())) return;
  const collapse = card.getByRole("button", { name: "Свернуть" });
  if (await collapse.count()) await collapse.click();
  else await card.locator(".cb-pe-session__summary").click();
}

async function confirmDateIfNeeded(page) {
  const confirm = page.getByRole("button", { name: /Изменить только эту дату|Всё равно сохранить/ });
  if (await confirm.isVisible().catch(() => false)) {
    await confirm.click();
  }
}

async function moveLessonViaMenu(page, index, direction) {
  const card = sessionCard(page, index);
  await card.getByRole("button", { name: "Действия урока" }).click();
  const name = direction > 0 ? "Переместить ниже" : "Переместить выше";
  await page.getByRole("menuitem", { name }).click();
  await page.waitForTimeout(250);
}

async function titles(page) {
  return page.locator(".cb-pe-session__title").allInnerTexts();
}

async function topics(page) {
  const cards = page.locator("[data-plan-index]");
  const count = await cards.count();
  const values = [];
  for (let i = 0; i < count; i += 1) {
    values.push(await cards.nth(i).getAttribute("data-plan-topic"));
  }
  return values;
}

async function runEditorScenarios(page, browserName, viewport) {
  const tag = `${browserName}/${viewport}`;
  const mobile = Number(String(viewport).split("x")[0]) <= 500;

  await openNewPlan(page);
  await dismissNoise(page);
  await page.getByLabel("Название плана").fill(`Smoke ${tag} ${Date.now()}`);

  // A. First date without lesson title
  await expandSession(page, 0);
  await page.getByLabel("Дата первого занятия").fill("2026-09-11");
  await field(page, "Цель").fill("Проверить сохранение даты");
  await collapseSession(page, 0);
  await expandSession(page, 0);
  await savePlan(page, mobile);
  await page.waitForFunction(() => {
    const fields = [...document.querySelectorAll(".cb-pe-field")];
    const first = fields.find((node) => node.querySelector("span")?.textContent?.trim() === "Дата первого занятия");
    return first?.querySelector("input[type=date]")?.value === "2026-09-11";
  }, null, { timeout: 15000 });
  const dateBeforeReload = await page.getByLabel("Дата первого занятия").inputValue();
  const urlAfterSave = page.url();
  await page.reload({ waitUntil: "domcontentloaded" });
  await dismissNoise(page);
  await page.getByLabel("Дата первого занятия").waitFor({ timeout: 20000 });
  await page.waitForTimeout(500);
  const dateAfterReload = await page.getByLabel("Дата первого занятия").inputValue();
  const aPass = dateBeforeReload === "2026-09-11" && dateAfterReload === "2026-09-11";
  record(`A first-date ${tag}`, aPass ? "PASS" : "FAIL", `beforeReload=${dateBeforeReload} afterReload=${dateAfterReload} url=${urlAfterSave}`);
  if (!aPass) await page.screenshot({ path: path.join(OUT_DIR, `A-${browserName}.png`) });

  // B. Topic typing slow then fast
  await expandSession(page, 0);
  const topic = field(page, "Тема");
  await topic.click();
  const beforeKey = await topic.evaluate((el) => el.closest("[data-plan-index]")?.getAttribute("data-plan-index"));
  await topic.fill("");
  await topic.pressSequentially("Системы ", { delay: 90 });
  const midFocus = await topic.evaluate((el) => document.activeElement === el);
  const midValue = await topic.inputValue();
  const midPos = await topic.evaluate((el) => el.selectionStart);
  await topic.pressSequentially("счисления", { delay: 15 });
  const afterFocus = await topic.evaluate((el) => document.activeElement === el);
  const afterValue = await topic.inputValue();
  const afterPos = await topic.evaluate((el) => el.selectionStart);
  const afterKey = await topic.evaluate((el) => el.closest("[data-plan-index]")?.getAttribute("data-plan-index"));
  const bPass = afterValue === "Системы счисления"
    && midValue === "Системы "
    && midFocus && afterFocus
    && afterPos === afterValue.length
    && midPos === midValue.length
    && beforeKey === afterKey;
  record(`B topic-typing ${tag}`, bPass ? "PASS" : "FAIL", `value="${afterValue}" mid="${midValue}" focus=${afterFocus}/${midFocus} cursor=${afterPos}/${afterValue.length} key ${beforeKey}->${afterKey}`);

  // C. Subtopic then goal/comment
  const subtopic = field(page, "Подтема");
  await subtopic.fill("Перевод чисел");
  await field(page, "Цель").fill("Уметь переводить числа");
  await field(page, "Комментарий").fill("Заметка после темы");
  const topicKept = await topic.inputValue();
  const subKept = await subtopic.inputValue();
  const cPass = topicKept === "Системы счисления" && subKept === "Перевод чисел";
  record(`C subtopic ${tag}`, cPass ? "PASS" : "FAIL", `topic="${topicKept}" subtopic="${subKept}"`);

  // Prepare 3 lessons for D/E/F
  await field(page, "Название").fill("Урок 1");
  await addLessonButton(page).click();
  await expandSession(page, 1);
  await sessionCard(page, 1).locator(".cb-pe-field").filter({ has: page.locator("span", { hasText: /^Название$/ }) }).locator("input").fill("Урок 2");
  await sessionCard(page, 1).locator(".cb-pe-field").filter({ has: page.locator("span", { hasText: /^Тема$/ }) }).locator("input").fill("Кодирование");
  await sessionCard(page, 1).locator(".cb-pe-field").filter({ has: page.locator("span", { hasText: /^Цель$/ }) }).locator("textarea").fill("Код");
  await addLessonButton(page).click();
  await expandSession(page, 2);
  await sessionCard(page, 2).locator(".cb-pe-field").filter({ has: page.locator("span", { hasText: /^Название$/ }) }).locator("input").fill("Урок 3");
  await sessionCard(page, 2).locator(".cb-pe-field").filter({ has: page.locator("span", { hasText: /^Тема$/ }) }).locator("input").fill("Логика");
  await sessionCard(page, 2).locator(".cb-pe-field").filter({ has: page.locator("span", { hasText: /^Цель$/ }) }).locator("textarea").fill("Лог");
  await page.waitForTimeout(300);
  const beforeDrag = {
    titles: await titles(page),
    topics: await topics(page),
  };

  await moveLessonViaMenu(page, 0, 1);
  await moveLessonViaMenu(page, 1, 1);
  const after13 = { titles: await titles(page), topics: await topics(page) };
  await moveLessonViaMenu(page, 2, -1);
  await moveLessonViaMenu(page, 1, -1);
  const after31 = { titles: await titles(page), topics: await topics(page) };
  await moveLessonViaMenu(page, 0, 1);
  const afterGroups = { titles: await titles(page), topics: await topics(page) };
  const dPass = after13.titles[2]?.includes("Урок 1")
    && after13.topics[2] === "Системы счисления"
    && after31.titles[0]?.includes("Урок 1")
    && after31.topics[0] === "Системы счисления"
    && afterGroups.topics.includes("Системы счисления")
    && afterGroups.topics.includes("Кодирование")
    && afterGroups.topics.includes("Логика");
  record(`D DnD ${tag}`, dPass ? "PASS" : "FAIL", JSON.stringify({ beforeDrag, after13, after31, afterGroups }, null, 2));

  // Restore order 1,2,3 if needed via menus for E/F
  // Current after last drag: likely 2,3,1. Move lesson 1 (now last) isn't needed if we work by title.

  // E. Manual date on "Урок 3"
  const logicIndex = (await titles(page)).findIndex((t) => t.includes("Урок 3"));
  const idx = logicIndex >= 0 ? logicIndex : 1;
  await expandSession(page, idx);
  const lessonDate = sessionCard(page, idx).locator('input[type="date"]').first();
  await lessonDate.fill("2026-10-02");
  await confirmDateIfNeeded(page);
  const manualDate = await lessonDate.inputValue();
  await sessionCard(page, idx).locator(".cb-pe-field").filter({ has: page.locator("span", { hasText: /^Комментарий$/ }) }).locator("input").fill("после ручной даты");
  await savePlan(page, mobile);
  await page.waitForTimeout(800);
  await collapseSession(page, idx);
  const other = idx === 0 ? 1 : 0;
  await expandSession(page, other);
  await expandSession(page, idx);
  const dateAfterEdit = await sessionCard(page, idx).locator('input[type="date"]').first().inputValue();
  const ePass = manualDate === "2026-10-02" && dateAfterEdit === "2026-10-02";
  record(`E manual-date ${tag}`, ePass ? "PASS" : "FAIL", `set=${manualDate} afterText/DnD/open=${dateAfterEdit}`);

  // F. Recalc first date
  await page.getByLabel("Дата первого занятия").fill("2026-09-04");
  await page.waitForTimeout(500);
  const firstDate = await page.getByLabel("Дата первого занятия").inputValue();
  const dates = [];
  const count = await page.locator("[data-plan-index]").count();
  for (let i = 0; i < count; i += 1) {
    await expandSession(page, i);
    dates.push(await sessionCard(page, i).locator('input[type="date"]').first().inputValue());
  }
  const fPass = firstDate === "2026-09-04" && dates.includes("2026-10-02");
  record(`F recalc ${tag}`, fPass ? "PASS" : "FAIL", `first=${firstDate} dates=${dates.join(",")}`);

  // G. Autosave while typing
  if (process.env.SMOKE_SKIP_G) {
    record(`G autosave-typing ${tag}`, "SKIP", "already passed on prior full run");
    return page.url();
  }
  await expandSession(page, 0);
  const goal = field(page, "Цель");
  await goal.click();
  await goal.fill("");
  const typed = "Печатаем во время автосохранения плана уроков";
  const start = Date.now();
  while (Date.now() - start < 34000) {
    await goal.pressSequentially("x", { delay: 40 });
    if ((await goal.inputValue()).length > 80) {
      await goal.fill("");
      await goal.pressSequentially(typed.slice(0, 8), { delay: 20 });
    }
  }
  const gFocus = await goal.evaluate((el) => document.activeElement === el);
  const gValue = await goal.inputValue();
  const gPos = await goal.evaluate((el) => el.selectionStart);
  const gPass = gFocus && gValue.length > 0 && gPos === gValue.length && !gValue.includes("undefined");
  record(`G autosave-typing ${tag}`, gPass ? "PASS" : "FAIL", `focus=${gFocus} value="${gValue}" cursor=${gPos}/${gValue.length}`);
  return page.url();
}

async function runExcelScenario(page, browserName) {
  const tag = browserName;
  await openNewPlan(page);
  await page.getByLabel("Название плана").fill(`Excel smoke ${Date.now()}`);
  await page.getByRole("button", { name: "Дополнительные действия" }).click();
  const downloadPromise = page.waitForEvent("download", { timeout: 20000 });
  await page.getByRole("button", { name: "Скачать шаблон Excel" }).click();
  const download = await downloadPromise;
  const templatePath = path.join(OUT_DIR, `template-${browserName}.xlsx`);
  await download.saveAs(templatePath);

  const filledPath = path.join(OUT_DIR, `filled-${browserName}.xlsx`);
  const py = `
from openpyxl import load_workbook
wb = load_workbook(${JSON.stringify(templatePath)})
ws = wb["Уроки"]
headers = {cell.value: idx for idx, cell in enumerate(ws[1], start=1)}
rows = [
    ("Системы счисления", "2026-09-11", "Системы счисления", "Перевод", "5", "Цель 1", "План 1", "ДЗ 1", "Комментарий 1"),
    ("Кодирование", None, "Кодирование информации", "", "6", "Цель 2", "План 2", "ДЗ 2", ""),
    ("Логика", "18.09.2026", "Алгебра логики", "", "7, 8", "Цель 3", "План 3", "", "ручная дата"),
]
for i, row in enumerate(rows, start=2):
    title, date, topic, sub, task, goal, plan, hw, comment = row
    ws.cell(i, headers["Название урока"], title)
    if date:
        ws.cell(i, headers["Дата занятия"], date)
    ws.cell(i, headers["Тема"], topic)
    ws.cell(i, headers["Подтема"], sub)
    ws.cell(i, headers["№ задания"], task)
    ws.cell(i, headers["Цель"], goal)
    ws.cell(i, headers["План урока"], plan)
    ws.cell(i, headers["Домашнее задание"], hw)
    ws.cell(i, headers["Комментарий"], comment)
wb.save(${JSON.stringify(filledPath)})
print("ok")
`;
  const pyResult = spawnSync("/Users/darsorokina/Projects/itflux/.venv/bin/python", ["-c", py], { encoding: "utf8" });
  if (pyResult.status !== 0) {
    record(`Excel fill ${tag}`, "FAIL", pyResult.stderr || pyResult.stdout);
    return;
  }

  await page.getByRole("button", { name: "Дополнительные действия" }).click();
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Загрузить Excel" }).click(),
  ]);
  await fileChooser.setFiles(filledPath);
  await page.getByRole("heading", { name: "Предпросмотр импорта" }).waitFor({ timeout: 20000 });
  const previewText = await page.locator(".cb-pe-excel__summary").innerText();
  const previewOk = /Найдено уроков:\s*3/.test(previewText);
  await page.getByRole("button", { name: "Импортировать" }).click();
  await page.locator(".cb-pe-excel__summary").waitFor({ state: "hidden", timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(800);
  const importedTitles = await titles(page);
  const importedTopics = await topics(page);
  await page.getByRole("button", { name: "Сохранить план" }).click();
  await page.waitForTimeout(1000);
  const url = page.url();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("[data-plan-index]").first().waitFor({ timeout: 20000 });
  const afterReloadTitles = await titles(page);
  const afterReloadTopics = await topics(page);
  const excelPass = previewOk
    && importedTitles.length >= 3
    && afterReloadTitles.length >= 3
    && afterReloadTopics.some((t) => t.includes("Системы"))
    && afterReloadTopics.some((t) => t.includes("Кодирование") || t.includes("Логика"));
  record(`Excel import ${tag}`, excelPass ? "PASS" : "FAIL", JSON.stringify({
    previewText,
    url,
    importedTitles,
    importedTopics,
    afterReloadTitles,
    afterReloadTopics,
  }, null, 2));

  // Roundtrip: export current, tweak, re-import update
  await page.getByRole("button", { name: "Дополнительные действия" }).click();
  const exportPromise = page.waitForEvent("download", { timeout: 20000 });
  await page.getByRole("button", { name: "Экспортировать текущий план" }).click();
  const exported = await exportPromise;
  const exportedPath = path.join(OUT_DIR, `exported-${browserName}.xlsx`);
  await exported.saveAs(exportedPath);
  const editedPath = path.join(OUT_DIR, `edited-${browserName}.xlsx`);
  const py2 = `
from openpyxl import load_workbook
wb = load_workbook(${JSON.stringify(exportedPath)})
ws = wb["Уроки"]
headers = {cell.value: idx for idx, cell in enumerate(ws[1], start=1)}
ws.cell(2, headers["Цель"], "Цель после экспорта")
wb.save(${JSON.stringify(editedPath)})
print("ok")
`;
  spawnSync("/Users/darsorokina/Projects/itflux/.venv/bin/python", ["-c", py2], { encoding: "utf8" });
  await page.getByRole("button", { name: "Дополнительные действия" }).click();
  const [chooser2] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Загрузить Excel" }).click(),
  ]);
  await chooser2.setFiles(editedPath);
  await page.getByRole("heading", { name: "Предпросмотр импорта" }).waitFor({ timeout: 20000 });
  const roundPreview = await page.locator(".cb-pe-excel__summary").innerText();
  if (await page.getByText("Обновить план").count()) {
    await page.getByText("Обновить план", { exact: false }).click();
  }
  await page.getByRole("button", { name: "Импортировать" }).click();
  await page.waitForTimeout(1000);
  await expandSession(page, 0);
  const goalAfter = await field(page, "Цель").inputValue();
  const countAfter = await page.locator("[data-plan-index]").count();
  const roundPass = countAfter === afterReloadTitles.length && goalAfter.includes("после экспорта");
  record(`Excel roundtrip ${tag}`, roundPass ? "PASS" : "FAIL", JSON.stringify({ roundPreview, goalAfter, countAfter, prevCount: afterReloadTitles.length }, null, 2));
}

async function withBrowser(browserType, name, viewport, fn) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({
    viewport,
    locale: "ru-RU",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  try {
    await login(page);
    await fn(page, name, `${viewport.width}x${viewport.height}`);
  } catch (err) {
    const shot = path.join(OUT_DIR, `error-${name}-${viewport.width}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    record(`crash ${name}/${viewport.width}`, "FAIL", `${err.stack || err}\nscreenshot=${shot}`);
  } finally {
    await browser.close();
  }
}

const chromeDesktop = { width: 1280, height: 800 };
const chromeMobile = { width: 390, height: 844 };

await withBrowser(chromium, "chromium", chromeDesktop, async (page, name, vp) => {
  await runEditorScenarios(page, name, vp);
  if (!process.env.SMOKE_SKIP_EXCEL) await runExcelScenario(page, name);
});

if (!process.env.SMOKE_CHROMIUM_ONLY) {
  await withBrowser(chromium, "chromium-mobile", chromeMobile, async (page, name, vp) => {
    await runEditorScenarios(page, name, vp);
  });

  try {
    await withBrowser(webkit, "webkit", chromeDesktop, async (page, name, vp) => {
      await runEditorScenarios(page, name, vp);
    });
  } catch (err) {
    record("webkit launch", "FAIL", String(err));
  }
}

const summaryPath = path.join(OUT_DIR, "results.json");
fs.writeFileSync(summaryPath, JSON.stringify(RESULTS, null, 2));
const failed = RESULTS.filter((item) => item.status === "FAIL");
console.log(`\nWrote ${summaryPath}. ${RESULTS.length - failed.length}/${RESULTS.length} passed.`);
if (failed.length) process.exitCode = 1;
