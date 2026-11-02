import { describe, expect, it } from "vitest";
import { desmosEmbed, geogebraEmbed, lessonEmbedFor, normalizeLessonLink, rutubeEmbed, vkVideoEmbed } from "./lessonEmbeds";

describe("r139 lesson embeds", () => {
  it("Desmos: пустой калькулятор и сохранённый график", () => {
    expect(desmosEmbed.toEmbedUrl("https://www.desmos.com/calculator")).toBe("https://www.desmos.com/calculator?embed");
    expect(desmosEmbed.toEmbedUrl("https://desmos.com/calculator/abc123?lang=ru")).toBe("https://www.desmos.com/calculator/abc123?embed&lang=ru");
    expect(desmosEmbed.fromEmbedUrl("https://www.desmos.com/geometry?embed")).toBe("https://www.desmos.com/geometry");
  });
  it("GeoGebra", () => {
    expect(geogebraEmbed.toEmbedUrl("https://www.geogebra.org/m/xyz12AB")).toBe("https://www.geogebra.org/material/iframe/id/xyz12AB");
    expect(geogebraEmbed.toEmbedUrl("https://www.geogebra.org/calculator")).toBe("https://www.geogebra.org/calculator");
  });
  it("RuTube", () => {
    const id = "c6cc4d620b1d4338901770a44b3e82f4";
    expect(rutubeEmbed.toEmbedUrl(`https://rutube.ru/video/${id}/`)).toBe(`https://rutube.ru/play/embed/${id}`);
    expect(rutubeEmbed.fromEmbedUrl(`https://rutube.ru/play/embed/${id}`)).toBe(`https://rutube.ru/video/${id}/`);
  });
  it("VK Видео", () => {
    expect(vkVideoEmbed.toEmbedUrl("https://vkvideo.ru/video-22822305_456242110")).toBe("https://vkvideo.ru/video_ext.php?oid=-22822305&id=456242110&hd=2");
    expect(vkVideoEmbed.toEmbedUrl("https://vk.com/video?z=video-1_2%2Fpl")).toBe("https://vkvideo.ru/video_ext.php?oid=-1&id=2&hd=2");
  });
  it("YouTube из стандартных и закладка для прочих", () => {
    expect(lessonEmbedFor("https://www.youtube.com/watch?v=dQw4w9WgXcQ")?.definition.type).toBe("youtube");
    expect(lessonEmbedFor("https://fipi.ru/ege")).toBeNull();
  });
  it("нормализация", () => {
    expect(normalizeLessonLink("desmos.com/calculator")).toBe("https://desmos.com/calculator");
    expect(normalizeLessonLink('<iframe src="https://rutube.ru/play/embed/x"></iframe>')).toBe("https://rutube.ru/play/embed/x");
    expect(normalizeLessonLink("javascript:alert(1)")).toBeNull();
    expect(normalizeLessonLink("привет")).toBeNull();
  });
});
