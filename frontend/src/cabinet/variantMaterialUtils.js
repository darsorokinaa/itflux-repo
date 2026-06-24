import { buildVariantMaterialPayload } from "./planItemAttachments";
import { devApiBase } from "../utils/devApiBase";

export function buildVariantOpenUrl(variant) {
  if (!variant?.level || !variant?.subject || !variant?.id) return "";
  return `/${variant.level}/${variant.subject}/variant/${variant.id}`;
}

export function formatVariantTitle(variant, variantNumber) {
  const num = variantNumber || variant?.id;
  const subject = variant?.subject_name || variant?.subject || "";
  const level = String(variant?.level || "").toUpperCase();
  const parts = [`Вариант №${num}`];
  if (subject) parts.push(subject);
  if (level) parts.push(level);
  return parts.join(" · ");
}

export async function fetchVariantByNumber(variantNumber) {
  const raw = String(variantNumber || "").trim();
  if (!raw || !/^\d+$/.test(raw)) {
    throw new Error("Введите номер сгенерированного варианта");
  }
  const apiBase = devApiBase();
  const res = await fetch(`${apiBase}/api/search_variant/?q=${encodeURIComponent(raw)}`, {
    credentials: apiBase ? "omit" : "same-origin",
  });
  if (!res.ok) {
    throw new Error("Не удалось найти вариант");
  }
  const data = await res.json();
  if (!data?.variant?.id) {
    throw new Error(`Вариант №${raw} не найден`);
  }
  return { variant: data.variant, variantNumber: raw };
}

export async function buildVariantMaterialFromNumber(variantNumber) {
  const { variant, variantNumber: num } = await fetchVariantByNumber(variantNumber);
  const url = buildVariantOpenUrl(variant);
  if (!url) {
    throw new Error("Не удалось построить ссылку на вариант");
  }
  const absoluteUrl = url.startsWith("http") ? url : `${window.location.origin}${url}`;
  return buildVariantMaterialPayload({
    title: formatVariantTitle(variant, num),
    url: absoluteUrl,
    direction: variant.level === "oge" || variant.level === "ege" ? variant.level : "other",
  });
}
