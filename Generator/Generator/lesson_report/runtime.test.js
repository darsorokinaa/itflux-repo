// node --test Generator/Generator/lesson_report/runtime.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const R = require("./runtime.js");

const report5 = JSON.parse(fs.readFileSync(path.join(__dirname, "content", "vhodnaya-diagnostika-po-matematike-5-klass.report.json"), "utf8"));

function lesson(report, vid) {
  const tasks = report.tasks.map((t) => {
    const e = R.effectiveTask(report, t.task_id, vid);
    return { id: t.task_id, title: e.title, points: e.max_points, answer: { type: "text", answers: ["ok" + t.task_id] } };
  });
  return {
    meta: { maxPoints: 14, grading: { "2": "0–6", "3": "7–9", "4": "10–12", "5": "13–14" } },
    variants: [{ id: vid, name: "Вариант " + vid, tasks }],
    tasks, report
  };
}
function answers(correct, wrong) {
  const s = {};
  correct.forEach((i) => { s[i] = "ok" + i; });
  Object.entries(wrong || {}).forEach(([i, v]) => { s[i] = v; });
  return s;
}

test("баллы считаются по points, максимум 14, отметка по grading", () => {
  const data = lesson(report5, 1);
  const m = R.computeReport({ data, variant: data.variants[0], selected: answers([1, 2, 3, 11, 12]) });
  assert.equal(m.max, 14);
  assert.equal(m.total, 7);
  assert.equal(m.mark, "3");
  assert.equal(m.band.code, "mark_3");
  assert.equal(m.percent, 50);
});

test("задания 11–12 помечены «проверяет учитель», результат предварительный", () => {
  const data = lesson(report5, 1);
  const m = R.computeReport({ data, variant: data.variants[0], selected: answers([11], { 12: "5" }) });
  const r11 = m.rows.find((r) => r.id === 11), r12 = m.rows.find((r) => r.id === 12), r1 = m.rows.find((r) => r.id === 1);
  assert.equal(r11.label, "ответ совпал · проверяет учитель");
  assert.equal(r11.earned, 2);
  assert.equal(r12.label, "неверно · проверяет учитель");
  assert.equal(r1.label, "нет ответа");
  assert.equal(m.preliminary, true);
  assert.deepEqual(m.teacher_task_numbers, [11, 12]);
});

test("вариант 3 (5 кл.): №12 — «Площадь фигуры», вариант 1 — «Перебор вариантов»", () => {
  const d3 = lesson(report5, 3), d1 = lesson(report5, 1);
  const m3 = R.computeReport({ data: d3, variant: d3.variants[0], selected: {} });
  const m1 = R.computeReport({ data: d1, variant: d1.variants[0], selected: {} });
  assert.match(m3.rows[11].title, /Площадь фигуры/);
  assert.match(m1.rows[11].title, /Перебор вариантов/);
});

test("ноль баллов -> mark_2_zero и условие many_skipped", () => {
  const data = lesson(report5, 2);
  const m = R.computeReport({ data, variant: data.variants[0], selected: {} });
  assert.equal(m.total, 0);
  assert.equal(m.band.code, "mark_2_zero");
  assert.equal(m.condition, "many_skipped");
  assert.ok(m.next_steps.length >= 3 && m.next_steps.length <= 5);
  assert.ok(m.weak_topics.length <= 7);
});

test("типичная ошибка распознаётся по ответу ученика", () => {
  const data = lesson(report5, 1);
  const tid = report5.tasks.map((t) => t.task_id).find((id) => (R.effectiveTask(report5, id, 1).typical_errors || []).some((e) => e.answer));
  const te = R.effectiveTask(report5, tid, 1).typical_errors.find((e) => e.answer);
  const m = R.computeReport({ data, variant: data.variants[0], selected: answers([], { [tid]: te.answer }) });
  assert.equal(m.rows.find((r) => r.id === tid).typical, te.comment);
});

test("плейсхолдеры подставляются, имя по умолчанию «Ученик»", () => {
  const data = lesson(report5, 1);
  const m = R.computeReport({ data, variant: data.variants[0], selected: answers([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) });
  assert.match(m.band.summary, /10 из 14 баллов \(71%\)/);
  assert.doesNotMatch(m.band.summary, /\{\w+\}/);
  // {student_name} по-прежнему поддерживается: без имени в уроке — «Ученик»
  const r2 = JSON.parse(JSON.stringify(report5));
  r2.result_bands.forEach((b) => { b.summary = "{student_name}: {total_score}/{max_score}"; });
  const d2 = lesson(r2, 1);
  const m2 = R.computeReport({ data: d2, variant: d2.variants[0], selected: answers([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) });
  assert.equal(m2.band.summary, "Ученик: 10/14");
});

test("весь контент экранируется (plain text)", () => {
  const evil = JSON.parse(JSON.stringify(report5));
  evil.result_bands.forEach((b) => { b.title = "<img src=x onerror=alert(1)>"; });
  evil.tasks[0].short_recommendation = "<script>alert(1)</script>";
  const data = lesson(evil, 1);
  const html = R.renderHtml(R.computeReport({ data, variant: data.variants[0], selected: {} }));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
});

test("без отчёта renderInto возвращает false (старый экран)", () => {
  const stage = { innerHTML: "old" };
  assert.equal(R.renderInto(stage, { data: { tasks: [] } }), false);
  assert.equal(stage.innerHTML, "old");
  const data = lesson(report5, 1);
  assert.equal(R.renderInto(stage, { data, variant: data.variants[0], selected: {} }), true);
  assert.match(stage.innerHTML, /class="slide results-slide ilr"/);
});

test("правила выбора шагов совпадают с report_pedagogy", () => {
  assert.equal(R.resolveCondition(80, 12, 0, 1), "high_percent");
  assert.equal(R.resolveCondition(30, 12, 2, 3), "low_percent");
  assert.equal(R.resolveCondition(50, 12, 6, 0), "many_skipped");
  assert.equal(R.resolveCondition(50, 12, 0, 6), "many_errors");
  assert.equal(R.resolveCondition(50, 12, 1, 2), "medium_percent");
  assert.deepEqual(R.pickSteps({ low_percent: ["a"], default: ["b", "c", "a"] }, "low_percent"), ["a", "b", "c"]);
  assert.equal(R.markFor({ "2": "0–6", "5": "13–14" }, 14), "5");
  assert.equal(R.markFor(null, 3), null);
});
