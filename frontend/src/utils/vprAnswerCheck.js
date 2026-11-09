/**
 * Клиентская сверка спецификации ВПР. Совпадает с Generator/vpr_answer_spec.py
 * в тех режимах, которые видны на странице варианта.
 * Файловые и графические форматы не становятся «неверно» и не получают полный балл.
 */

function normalize(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "")
    .replace(/\u00a0/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function decimalKey(value) {
  const text = normalize(value).replace("−", "-");
  if (/^[-]?\d+(?:[.,]\d+)?$/.test(text)) return text.replace(",", ".");
  return text;
}

export function valuesEqual(expected, actual) {
  const left = normalize(expected);
  const right = normalize(actual);
  if (!left || !right) return false;
  const fraction = /^[-+]?\d+\/[-+]?\d+$/;
  if (fraction.test(left) || fraction.test(right)) {
    if (!fraction.test(left) || !fraction.test(right)) return false;
    const [a, b] = left.split("/").map(Number);
    const [c, d] = right.split("/").map(Number);
    if (!b || !d) return false;
    return a * d === c * b;
  }
  if (left.includes("√") || right.includes("√")) return left === right;
  return decimalKey(left) === decimalKey(right);
}

export function checkMode(format, maxScore = 1) {
  const fmt = String(format || "");
  const manual = new Set([
    "mark_point_on_line",
    "mark_point_in_region",
    "coordinate_pair",
    "interval_union",
    "any_of_programs",
    "document_file",
    "program_file",
    "two_parts: series; roots",
    "two_parts: graph_points; parameter",
  ]);
  if (fmt.startsWith("extended:") || manual.has(fmt)) return "manual";
  if (fmt === "two_parts: number; graph_points") return "mixed";
  if (fmt.startsWith("two_parts:")) return "auto";
  if (fmt === "truth_table_column" || fmt === "multiple_choice_set") return "auto";
  const justified = new Set([
    "number", "number_or_fraction", "number_or_radical", "number_list",
    "vertex_label", "single_choice", "matching_sequence", "number_pairs",
    "word", "sequence", "number_in_base", "two_numbers", "fraction",
  ]);
  if (justified.has(fmt) && Number(maxScore) >= 2) return "manual";
  if (justified.has(fmt)) return "auto";
  return "manual";
}

function statusOf(points, maximum, { pending, answered }) {
  if (!answered) return "unanswered";
  if (pending) return "pending_review";
  if (maximum > 0 && points >= maximum) return "correct";
  if (points > 0) return "partial";
  return "incorrect";
}

function choicePoints(data, text, maximum) {
  const choices = (data.choices || []).map(String);
  const order = String(data.order || "");
  const glued = order.includes("без разделител");
  const got = glued && choices.every((part) => part.length === 1)
    ? [...normalize(text)]
    : text.split(/[,;]/).map((part) => part.trim()).filter(Boolean);
  if (!got.length || !choices.length) return 0;
  const ascending = order.includes("ascending") || order.includes("возраст");
  const sameBag = choices.length === got.length && choices.every((item) => got.includes(item));
  if (sameBag) {
    if (!ascending || got.join("\0") === choices.join("\0")) return maximum;
    return 0;
  }
  const count = (list) => list.reduce((map, item) => {
    map[item] = (map[item] || 0) + 1;
    return map;
  }, {});
  const ce = count(choices);
  const cu = count(got);
  let extra = 0;
  let missing = 0;
  new Set([...Object.keys(ce), ...Object.keys(cu)]).forEach((key) => {
    const delta = (cu[key] || 0) - (ce[key] || 0);
    if (delta > 0) extra += delta;
    if (delta < 0) missing -= delta;
  });
  if (maximum >= 2 && extra + missing === 1 && !(extra && missing)) {
    const sorted = [...got].sort();
    if (ascending && got.join("\0") !== sorted.join("\0")) return 0;
    return 1;
  }
  return 0;
}

export function scoreVprSpec(spec, studentAnswer, maxScore = 1) {
  const maximum = Math.max(0, Number(maxScore) || 0);
  const text = String(studentAnswer ?? "").trim();
  const answered = Boolean(text);
  const fmt = String(spec?.answer_format || "");
  const mode = checkMode(fmt, maximum);
  const data = spec?.answer_data || {};
  if (mode === "mixed") {
    const numbered = text.split(/2\s*\)/)[0].replace(/^\s*1\s*\)\s*/, "").replace(/[;,\s]+$/g, "").trim();
    const value = data["9.1"]?.value;
    const points = answered && valuesEqual(value, numbered || text) ? Number(data["9.1"]?.score || 1) : 0;
    return {
      mode,
      status: statusOf(points, maximum, { pending: answered, answered }),
      points: answered ? points : 0,
      max_points: maximum,
    };
  }
  if (mode === "manual") {
    return {
      mode,
      status: statusOf(0, maximum, { pending: answered, answered }),
      points: 0,
      max_points: maximum,
    };
  }
  if (fmt === "multiple_choice_set") {
    const points = answered ? choicePoints(data, text, maximum) : 0;
    return { mode: "auto", status: statusOf(points, maximum, { pending: false, answered }), points, max_points: maximum };
  }
  if (fmt === "number" || fmt === "number_or_fraction" || fmt === "number_or_radical" || fmt === "fraction") {
    const fractionOk = fmt !== "fraction" || /^[-+]?\d+\/[-+]?\d+$/.test(normalize(text));
    const points = answered && fractionOk && valuesEqual(data.value, text) ? maximum : 0;
    return { mode: "auto", status: statusOf(points, maximum, { pending: false, answered }), points, max_points: maximum };
  }
  if (fmt === "word" || fmt === "number_in_base") {
    const points = answered && normalize(data.value) === normalize(text) ? maximum : 0;
    return { mode: "auto", status: statusOf(points, maximum, { pending: false, answered }), points, max_points: maximum };
  }
  if (fmt === "truth_table_column") {
    const expected = (data.rows || []).map((row) => String(row.F)).join("");
    const parts = text.match(/[01]+/g) || [];
    const singles = parts.filter((part) => part.length === 1);
    const got = singles.length === expected.length ? singles.join("") : parts.join("").length === expected.length ? parts.join("") : "";
    const wrong = got ? [...got].filter((bit, index) => bit !== expected[index]).length : expected.length;
    let points = 0;
    if (got && wrong === 0) points = maximum;
    else if (got && maximum >= 2 && wrong === 1) points = 1;
    return { mode: "auto", status: statusOf(points, maximum, { pending: false, answered }), points, max_points: maximum };
  }
  return {
    mode: mode || "manual",
    status: statusOf(0, maximum, { pending: answered, answered }),
    points: 0,
    max_points: maximum,
  };
}
