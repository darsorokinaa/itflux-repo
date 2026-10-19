/* itflux lesson report runtime v1 (r79).
 * Расширенный итоговый экран каталожного урока: баллы с учётом points, отметка по meta.grading,
 * вывод по диапазону, темы для повторения, «что делать дальше», тексты для ученика/родителя/учителя.
 * Контент — window.LESSON_DATA.report (встраивается командой import_lesson_report).
 * Весь контент выводится как plain text (escape). Если отчёта нет — возвращает false,
 * и урок показывает старый экран результатов.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ItfluxLessonReport = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var VERSION = 1;
  var PLACEHOLDERS = ["student_name", "total_score", "max_score", "percent", "correct_count",
    "tasks_count", "weak_topics", "skipped_count", "mark"];
  var TASK_FIELDS = ["title", "topic", "subtopic", "skill_group", "planned_result", "on_correct",
    "short_recommendation", "detailed_recommendation", "next_lesson_action", "student_hint",
    "parent_hint", "teacher_hint", "typical_errors"];

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function defaultNormalize(value) {
    return String(value == null ? "" : value).trim().toLowerCase().replace(/\s+/g, " ");
  }

  function parseRange(text) {
    var m = String(text || "").match(/(\d+)\s*[–—-]\s*(\d+)/);
    if (m) return [Number(m[1]), Number(m[2])];
    var one = String(text || "").match(/^\s*(\d+)\s*$/);
    return one ? [Number(one[1]), Number(one[1])] : null;
  }

  function markFor(grading, points) {
    if (!grading || typeof grading !== "object") return null;
    var keys = Object.keys(grading);
    for (var i = 0; i < keys.length; i++) {
      var r = parseRange(grading[keys[i]]);
      if (r && points >= r[0] && points <= r[1]) return keys[i];
    }
    return null;
  }

  function effectiveTask(report, taskId, variantId) {
    var base = null;
    (report.tasks || []).forEach(function (t) { if (Number(t.task_id) === Number(taskId)) base = t; });
    if (!base) return null;
    var out = {};
    Object.keys(base).forEach(function (k) { if (k !== "variant_overrides") out[k] = base[k]; });
    var ov = (base.variant_overrides || {})[String(variantId)] || {};
    TASK_FIELDS.forEach(function (k) { if (Object.prototype.hasOwnProperty.call(ov, k)) out[k] = ov[k]; });
    return out;
  }

  function fill(template, ctx) {
    return String(template || "").replace(/\{(\w+)\}/g, function (all, key) {
      return PLACEHOLDERS.indexOf(key) >= 0 && ctx[key] != null ? String(ctx[key]) : all;
    });
  }

  function resolveCondition(percent, tasksCount, skipped, wrong) {
    // те же правила, что report_pedagogy._resolve_next_condition (без slow_first_task: время не замеряется)
    if (tasksCount && skipped >= tasksCount / 2) return "many_skipped";
    if (percent < 40) return "low_percent";
    if (tasksCount && wrong >= tasksCount / 2) return "many_errors";
    if (percent >= 70) return "high_percent";
    return "medium_percent";
  }

  function pickSteps(nextSteps, condition) {
    nextSteps = nextSteps || {};
    var steps = (nextSteps[condition] || []).slice(0, 5);
    if (steps.length < 3 && condition !== "default") steps = steps.concat(nextSteps["default"] || []);
    var seen = {}, out = [];
    steps.forEach(function (s) { if (s && !seen[s]) { seen[s] = 1; out.push(s); } });
    return out.slice(0, 5);
  }

  /** Чистая функция: модель отчёта по ответам. Не трогает DOM. */
  function computeReport(ctx) {
    var data = ctx.data || {};
    var report = ctx.report || data.report;
    var variant = ctx.variant || { id: 1, tasks: data.tasks || [] };
    var normalize = ctx.normalize || defaultNormalize;
    var selected = ctx.selected || {};
    var tasks = variant.tasks || [];
    var isCorrect = ctx.isAnswerCorrect || function (task) {
      var acc = ((task.answer && task.answer.answers) || []).map(normalize).filter(Boolean);
      if (!acc.length) return null;
      var v = normalize(selected[task.id]);
      if (!v) return false;
      return acc.indexOf(v) >= 0;
    };

    var rows = tasks.map(function (task, index) {
      var rt = effectiveTask(report, task.id, variant.id) || {};
      var points = Number(task.points != null ? task.points : 1) || 0;
      var result = isCorrect(task);
      var given = normalize(selected[task.id]);
      var status = result === true ? "correct" : result === false ? (given ? "wrong" : "empty") : "unchecked";
      var teacher = rt.check === "teacher";
      var label = { correct: "верно", wrong: "неверно", empty: "нет ответа", unchecked: "без проверки" }[status];
      if (teacher && status === "correct") label = "ответ совпал · проверяет учитель";
      else if (teacher && status === "wrong") label = "неверно · проверяет учитель";
      var typical = null;
      if (status === "wrong") {
        (rt.typical_errors || []).forEach(function (te) {
          if (!typical && te && te.answer != null && normalize(te.answer) === given) typical = te.comment;
        });
      }
      return {
        id: task.id, number: task.id != null ? task.id : index + 1,
        title: rt.title || task.title || "Задание",
        subtopic: rt.subtopic || "", topic: rt.topic || "", skill_group: rt.skill_group || "",
        points: points, earned: status === "correct" ? points : 0,
        status: status, label: label, teacher: teacher,
        recommendation: status === "correct" ? (rt.on_correct || "") : (rt.short_recommendation || ""),
        typical: typical,
        student_hint: rt.student_hint || "", parent_hint: rt.parent_hint || "",
        teacher_hint: rt.teacher_hint || "", next_lesson_action: rt.next_lesson_action || ""
      };
    });

    var total = rows.reduce(function (a, r) { return a + r.earned; }, 0);
    var max = rows.reduce(function (a, r) { return a + r.points; }, 0);
    var percent = max ? Math.round((total / max) * 100) : 0;
    var correct = rows.filter(function (r) { return r.status === "correct"; }).length;
    var skipped = rows.filter(function (r) { return r.status === "empty"; }).length;
    var wrong = rows.filter(function (r) { return r.status === "wrong"; }).length;
    var mark = markFor((data.meta || {}).grading, total);
    var weakRows = rows.filter(function (r) { return r.status === "wrong" || r.status === "empty"; });
    var weak = [], seen = {};
    weakRows.forEach(function (r) {
      var t = (r.subtopic || r.title || "").trim();
      var k = t.toLowerCase();
      if (t && !seen[k] && weak.length < 7) { seen[k] = 1; weak.push(t); }
    });
    var band = null;
    (report.result_bands || []).forEach(function (b) {
      if (!band && total >= b.min_points && total <= b.max_points) band = b;
    });
    var tctx = {
      student_name: ctx.studentName || "Ученик", total_score: total, max_score: max, percent: percent,
      correct_count: correct, tasks_count: rows.length, weak_topics: weak.length ? weak.join(", ") : "—",
      skipped_count: skipped, mark: mark || "—"
    };
    var condition = resolveCondition(percent, rows.length, skipped, wrong);
    var groups = (report.skill_groups || []).map(function (g) {
      var gr = rows.filter(function (r) { return (g.task_ids || []).indexOf(Number(r.id)) >= 0; });
      return {
        code: g.code, title: g.title,
        earned: gr.reduce(function (a, r) { return a + r.earned; }, 0),
        max: gr.reduce(function (a, r) { return a + r.points; }, 0)
      };
    });
    var teacherRows = rows.filter(function (r) { return r.teacher; });
    return {
      version: VERSION,
      variant_id: variant.id, variant_name: variant.name || ("Вариант " + variant.id),
      total: total, max: max, percent: percent, mark: mark,
      correct: correct, wrong: wrong, skipped: skipped, tasks_count: rows.length,
      preliminary: teacherRows.length > 0,
      teacher_task_numbers: teacherRows.map(function (r) { return r.number; }),
      rows: rows, groups: groups, weak_topics: weak, weak_rows: weakRows,
      band: band ? {
        code: band.code, result_level: band.result_level || "", title: band.title || "",
        summary: fill(band.summary, tctx), student_text: band.student_text || "",
        parent_text: band.parent_text || "", teacher_text: band.teacher_text || ""
      } : null,
      condition: condition, next_steps: pickSteps(report.next_steps, condition),
      teacher_notes: report.teacher_notes || ""
    };
  }

  function statusClass(r) {
    if (r.status === "correct") return r.teacher ? "ilr-st-pending" : "ilr-st-ok";
    if (r.status === "unchecked") return "ilr-st-neutral";
    return "ilr-st-bad";
  }

  function hintsList(rows, field, limit) {
    var items = rows.filter(function (r) { return r[field]; }).slice(0, limit).map(function (r) {
      return "<li><b>№" + esc(r.number) + ". " + esc(r.title) + ".</b> " + esc(r[field]) + "</li>";
    }).join("");
    return items ? "<ul class=\"ilr-hints\">" + items + "</ul>" : "";
  }

  /** HTML итогового экрана. Все строки из контента экранируются. */
  function renderHtml(m) {
    var b = m.band;
    var nums = m.teacher_task_numbers.join(" и ");
    var rowsHtml = m.rows.map(function (r) {
      return "<tr class=\"" + statusClass(r) + "\">" +
        "<td class=\"ilr-num\" data-label=\"№\">" + esc(r.number) + "</td>" +
        "<td class=\"ilr-title\" data-label=\"Задание\">" + esc(r.title) +
          (r.subtopic && r.subtopic !== r.title ? "<small>" + esc(r.subtopic) + "</small>" : "") + "</td>" +
        "<td class=\"ilr-pts\" data-label=\"Баллы\">" + esc(r.earned) + " / " + esc(r.points) + "</td>" +
        "<td class=\"ilr-status\" data-label=\"Статус\"><span class=\"ilr-pill\">" + esc(r.label) + "</span></td>" +
        "<td class=\"ilr-rec\" data-label=\"Что сделать\">" + esc(r.recommendation) +
          (r.typical ? "<small class=\"ilr-typical\">Возможная причина: " + esc(r.typical) + "</small>" : "") + "</td>" +
        "</tr>";
    }).join("");
    var groupsHtml = m.groups.length ? (
      "<section class=\"ilr-card\"><h3>По блокам умений</h3><table class=\"ilr-groups\"><tbody>" +
      m.groups.map(function (g) {
        var cls = g.max && g.earned >= g.max ? "ilr-st-ok" : g.earned > 0 ? "ilr-st-mid" : "ilr-st-bad";
        return "<tr class=\"" + cls + "\"><td>" + esc(g.title) + "</td><td class=\"ilr-pts\">" +
          esc(g.earned) + " из " + esc(g.max) + "</td></tr>";
      }).join("") + "</tbody></table></section>") : "";
    var weakHtml = m.weak_topics.length
      ? "<ul class=\"ilr-list\">" + m.weak_topics.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>"
      : "<p class=\"ilr-muted\">Все задания выполнены верно — тем для повторения нет.</p>";
    var stepsHtml = m.next_steps.length
      ? "<ol class=\"ilr-list\">" + m.next_steps.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ol>"
      : "";
    var teacherItems = m.weak_rows.filter(function (r) { return r.teacher_hint || r.next_lesson_action; }).map(function (r) {
      return "<li><b>№" + esc(r.number) + ". " + esc(r.title) + ".</b> " + esc(r.teacher_hint) +
        (r.next_lesson_action ? " <i>На следующем занятии:</i> " + esc(r.next_lesson_action) : "") + "</li>";
    }).join("");
    return "" +
      "<article class=\"slide results-slide ilr\" data-ilr-version=\"" + VERSION + "\">" +
      "<div class=\"slide__number\">✓</div>" +
      "<h2 class=\"slide__title\">Результаты · " + esc(m.variant_name) + "</h2>" +
      "<div class=\"ilr-scroll\">" +
      "<section class=\"ilr-hero ilr-level-" + esc(b ? b.result_level : "none") + "\">" +
        "<div class=\"ilr-score\"><b>" + esc(m.total) + "</b> из " + esc(m.max) + " баллов</div>" +
        (m.mark ? "<div class=\"ilr-mark\">Отметка «" + esc(m.mark) + "»</div>" : "") +
        "<div class=\"ilr-meta\">" + esc(m.percent) + "% баллов · верно " + esc(m.correct) + " из " + esc(m.tasks_count) + " заданий</div>" +
        (m.preliminary ? "<p class=\"ilr-note\">Результат предварительный: задания " + esc(nums) +
          " с развёрнутым ответом проверяет учитель по критериям (0–2 балла). Здесь сверен только ответ.</p>" : "") +
      "</section>" +
      (b ? "<section class=\"ilr-card ilr-band\"><h3>" + esc(b.title) + "</h3><p>" + esc(b.summary) + "</p></section>" : "") +
      "<section class=\"ilr-card\"><h3>Результаты по заданиям</h3><table class=\"ilr-table\"><thead><tr>" +
        "<th>№</th><th>Задание</th><th>Баллы</th><th>Статус</th><th>Что сделать</th></tr></thead><tbody>" +
        rowsHtml + "</tbody></table></section>" +
      groupsHtml +
      "<section class=\"ilr-card\"><h3>Темы для повторения</h3>" + weakHtml + "</section>" +
      (stepsHtml ? "<section class=\"ilr-card\"><h3>Что делать дальше</h3>" + stepsHtml + "</section>" : "") +
      (b && b.student_text || m.weak_rows.length ? "<section class=\"ilr-card ilr-aud\"><h3>Ученику</h3>" +
        (b && b.student_text ? "<p>" + esc(b.student_text) + "</p>" : "") + hintsList(m.weak_rows, "student_hint", 3) + "</section>" : "") +
      (b && b.parent_text ? "<details class=\"ilr-card ilr-aud\"><summary>Родителям</summary><p>" + esc(b.parent_text) + "</p>" +
        hintsList(m.weak_rows, "parent_hint", 3) + "</details>" : "") +
      ((b && b.teacher_text) || teacherItems || m.teacher_notes ? "<details class=\"ilr-card ilr-aud\"><summary>Учителю</summary>" +
        (b && b.teacher_text ? "<p>" + esc(b.teacher_text) + "</p>" : "") +
        (teacherItems ? "<ul class=\"ilr-hints\">" + teacherItems + "</ul>" : "") +
        (m.teacher_notes ? "<p class=\"ilr-muted ilr-notes\">" + esc(m.teacher_notes) + "</p>" : "") + "</details>" : "") +
      "</div></article>";
  }

  /** Вызывается из renderResults() урока. true — экран нарисован; false — показать старый экран. */
  function renderInto(stage, ctx) {
    var data = (ctx && ctx.data) || {};
    var report = data.report;
    if (!stage || !report || report.format !== "itflux.lesson-variant-report") return false;
    var model = computeReport(ctx);
    stage.innerHTML = renderHtml(model);
    return true;
  }

  return {
    version: VERSION, esc: esc, markFor: markFor, effectiveTask: effectiveTask, fill: fill,
    resolveCondition: resolveCondition, pickSteps: pickSteps,
    computeReport: computeReport, renderHtml: renderHtml, renderInto: renderInto
  };
});
