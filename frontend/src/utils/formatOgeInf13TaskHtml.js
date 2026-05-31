/**
 * Улучшает HTML длинного задания ОГЭ информатика №13 (презентация): заголовок блока требований,
 * визуально отдельные строки с ● / • / нумерацией 1. 2. / длинным тире «—».
 * Работает поверх типичного вывода CKEditor (<p>, <br>).
 */

function mergePOpeningAttrs(attrs, newClassStr) {
  const a = String(attrs ?? "");
  const extra = newClassStr.trim();
  if (!extra) return a;
  const m = a.match(/class\s*=\s*(["'])([^"']*)\1/i);
  if (m) {
    const q = m[1];
    const existing = (m[2] || "").trim();
    const merged = `${existing} ${extra}`.trim();
    return a.replace(/class\s*=\s*(["'])([^"']*)\1/i, `class=${q}${merged}${q}`);
  }
  const t = a.trim();
  if (!t) return ` class="${extra}"`;
  return `${a} class="${extra}"`;
}

/** В ФИПИ встречаются обе формулировки заголовка блока требований. */
const OGE_INF_13_REQUIREMENTS_PHRASES = [
  "Требования к оформлению презентации",
  "Требования к оформлению работы",
];

function findRequirementsHeadingInText(t) {
  const s = String(t || "");
  let best = -1;
  let phrase = "";
  for (const p of OGE_INF_13_REQUIREMENTS_PHRASES) {
    const i = s.toLowerCase().indexOf(p.toLowerCase());
    if (i !== -1 && (best === -1 || i < best)) {
      best = i;
      phrase = s.slice(i, i + p.length);
    }
  }
  return best === -1 ? null : { index: best, phrase };
}

/**
 * API отдаёт «почти plain text» с \\n и формулами в <span> (process_latex), без <p>.
 * Тогда splitDensePlainParagraphs не находил абзацы.
 */
function normalizePlainNewlinesToParagraphHtml(html) {
  const s = String(html ?? "");
  if (/<p\b/i.test(s)) return s;
  if (!/\r?\n/.test(s)) return s;
  let t = s.replace(/\r\n/g, "\n").trim();
  t = t.replace(/\n/g, "<br>");
  t = t.replace(/(?:<br\s*\/?>\s*){2,}/gi, "</p><p>");
  return `<p>${t}</p>`;
}

/** Внутри <p> нет блочной разметки: допустимы <br> и <span> (формулы после process_latex). */
function isPlainLikeParagraphInner(inner) {
  const withoutBr = String(inner).replace(/<br\s*\/?>/gi, " ");
  const probe = withoutBr.replace(/<\/?span\b[^>]*>/gi, "");
  return !/<(?!br\b)[a-z!/?]/i.test(probe);
}

function shouldDenseSplitNormalizedText(t) {
  const s = String(t || "").trim();
  if (s.length < 24) return false;
  if (/Требования\s+к\s+оформлению\s+(?:презентации|работы)\b/i.test(s)) return true;
  return /[●•]/.test(s) && /(?:^|\s)[12]\.\s+[А-ЯЁа-яA-Za-z«(—0-9]/.test(s);
}

function splitChunkIntoBulletPieces(chunk) {
  let parts = [String(chunk || "").trim()].filter(Boolean);
  parts = parts.flatMap((p) => p.split(/(?<=[:;])\s*(?=[●•])/));
  parts = parts.flatMap((p) => p.split(/\s(?=[●•])/));
  return parts.map((x) => x.trim()).filter(Boolean);
}

function formatDensePieceAsParagraph(piece) {
  const p = String(piece || "").trim();
  if (!p) return "";

  const numM = p.match(/^([12])\.\s+(.*)$/s);
  if (numM) {
    const n = numM[1];
    const rest = String(numM[2] || "").trim();
    const dashParts = rest.length ? rest.split(/\s(?=—\s)/) : [""];
    const blocks = [];
    const first = (dashParts[0] || "").trim();
    blocks.push(
      `<p${mergePOpeningAttrs("", "oge-inf-13-line oge-inf-13-line--numbered")}><span class="oge-inf-13-li-num">${n}.</span> ${first}</p>`
    );
    for (let i = 1; i < dashParts.length; i++) {
      const seg = dashParts[i].trim();
      if (seg) blocks.push(formatDensePieceAsParagraph(seg));
    }
    return blocks.join("");
  }

  if (p.startsWith("●")) {
    const rest = p.slice(1).trim();
    return `<p class="oge-inf-13-line oge-inf-13-line--blob"><span class="oge-inf-13-li-mark oge-inf-13-li-mark--blob" aria-hidden="true">●</span> ${rest}</p>`;
  }
  if (p.startsWith("•")) {
    const rest = p.slice(1).trim();
    return `<p class="oge-inf-13-line oge-inf-13-line--bullet"><span class="oge-inf-13-li-mark oge-inf-13-li-mark--bullet" aria-hidden="true">•</span> ${rest}</p>`;
  }
  if (p.startsWith("—")) {
    const rest = p.replace(/^—\s+/, "").trim();
    return `<p class="oge-inf-13-line oge-inf-13-line--dash"><span class="oge-inf-13-li-mark oge-inf-13-li-mark--dash" aria-hidden="true">—</span> ${rest}</p>`;
  }

  return `<p class="oge-inf-13-after-heading">${p}</p>`;
}

/**
 * Один абзац целиком без <br>-разрывов по маркерам: «Требования», 1./2., ●/•.
 * Иначе маркеры в середине <p> не попадают под правила «с начала абзаца».
 */
function splitDensePlainParagraphs(html) {
  return html.replace(/<p(\b[^>]*)>([\s\S]*?)<\/p>/gi, (full, attrs, inner) => {
    if (!isPlainLikeParagraphInner(inner)) return full;
    let t = String(inner).replace(/<br\s*\/?>/gi, " ").replace(/\s+/g, " ").trim();
    t = t.replace(/([.!?])(Требования)/i, "$1 $2");
    if (!shouldDenseSplitNormalizedText(t)) return full;

    const blocks = [];
    const found = findRequirementsHeadingInText(t);
    let body = t;
    if (found) {
      const head = t.slice(0, found.index).trimEnd();
      body = t.slice(found.index + found.phrase.length).trimStart();
      if (head) blocks.push(`<p${attrs}>${head}</p>`);
      blocks.push(`<h4 class="oge-inf-13-requirements-heading">${found.phrase}</h4>`);
    }

    const numChunks = body.split(/\s(?=[12]\.\s)/).map((x) => x.trim()).filter(Boolean);
    for (const ch of numChunks) {
      for (const piece of splitChunkIntoBulletPieces(ch)) {
        blocks.push(formatDensePieceAsParagraph(piece));
      }
    }

    return blocks.join("");
  });
}

export function formatOgeInformaticsTask13Html(html) {
  if (html == null || typeof html !== "string") return html;
  let s = html;
  if (!s.includes("Требования") && !s.includes("●") && !s.includes("•")) {
    return s;
  }

  s = normalizePlainNewlinesToParagraphHtml(s);
  s = splitDensePlainParagraphs(s);

  // Отдельный абзац «Требования…» → заголовок секции
  for (const phrase of OGE_INF_13_REQUIREMENTS_PHRASES) {
    const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp(`<p([^>]*)>\\s*(${esc})\\s*<\\/p>`, "gi"), '<h4 class="oge-inf-13-requirements-heading">$2</h4>');
  }

  // «Требования…» в одном <p> с основным текстом (до закрывающего </p> без вложенных блочных тегов)
  s = s.replace(
    /<p([^>]*)>([^<]*?)\s(Требования к оформлению (?:презентации|работы))([\s\S]*?)<\/p>/gi,
    (full, attrs, intro, phrase, rest) => {
      if (/<h4 class="oge-inf-13-requirements-heading"/i.test(full)) return full;
      if (/<(div|table|ul|ol|h[1-6])\b/i.test(rest)) return full;
      const a = String(intro || "").trimEnd();
      const tail = String(rest || "").trimStart();
      if (!a && !tail) return full;
      return `<p${attrs}>${a}</p><h4 class="oge-inf-13-requirements-heading">${phrase}</h4><p class="oge-inf-13-after-heading">${tail}</p>`;
    }
  );

  const line = (attrs, kind, markHtml, innerPrefix = "") => {
    const cls = `oge-inf-13-line oge-inf-13-line--${kind}`;
    return `<p${mergePOpeningAttrs(attrs, cls)}>${innerPrefix}${markHtml}`;
  };

  s = s.replace(/<p([^>]*)>\s*●\s*/gi, (_, attrs) =>
    line(
      attrs,
      "blob",
      '<span class="oge-inf-13-li-mark oge-inf-13-li-mark--blob" aria-hidden="true">●</span> '
    )
  );
  s = s.replace(/<br\s*\/?>\s*●\s*/gi, '</p><p class="oge-inf-13-line oge-inf-13-line--blob"><span class="oge-inf-13-li-mark oge-inf-13-li-mark--blob" aria-hidden="true">●</span> ');

  s = s.replace(/<p([^>]*)>\s*•\s*/gi, (_, attrs) =>
    line(
      attrs,
      "bullet",
      '<span class="oge-inf-13-li-mark oge-inf-13-li-mark--bullet" aria-hidden="true">•</span> '
    )
  );
  s = s.replace(/<br\s*\/?>\s*•\s*/gi, '</p><p class="oge-inf-13-line oge-inf-13-line--bullet"><span class="oge-inf-13-li-mark oge-inf-13-li-mark--bullet" aria-hidden="true">•</span> ');

  s = s.replace(/<p([^>]*)>\s*(\d+)\.\s+/g, (full, attrs, num) => {
    if (/\boge-inf-13-line--numbered\b/.test(String(attrs))) return full;
    return `<p${mergePOpeningAttrs(attrs, "oge-inf-13-line oge-inf-13-line--numbered")}><span class="oge-inf-13-li-num">${num}.</span> `;
  });

  s = s.replace(/<p([^>]*)>\s*—\s+/gi, (_, attrs) =>
    line(
      attrs,
      "dash",
      '<span class="oge-inf-13-li-mark oge-inf-13-li-mark--dash" aria-hidden="true">—</span> '
    )
  );
  s = s.replace(/<br\s*\/?>\s*—\s*/gi, '</p><p class="oge-inf-13-line oge-inf-13-line--dash"><span class="oge-inf-13-li-mark oge-inf-13-li-mark--dash" aria-hidden="true">—</span> ');

  return s;
}
