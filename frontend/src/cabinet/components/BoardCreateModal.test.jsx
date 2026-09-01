/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BOARD_TITLE,
  lessonDisplayTitle,
  nextBoardTitleOnLessonChange,
} from "./BoardCreateModal";

describe("board create title from lesson", () => {
  it("берёт название урока", () => {
    expect(lessonDisplayTitle({ title: "Урок по алгоритмам" })).toBe("Урок по алгоритмам");
    expect(lessonDisplayTitle({ topic: "Бинарный поиск" })).toBe("Бинарный поиск");
    expect(lessonDisplayTitle(null)).toBe("");
  });

  it("подставляет название урока вместо «Новая доска»", () => {
    expect(nextBoardTitleOnLessonChange({
      currentTitle: DEFAULT_BOARD_TITLE,
      previousLessonTitle: "",
      nextLessonTitle: "Урок по алгоритмам",
    })).toBe("Урок по алгоритмам");
  });

  it("меняет название, если оно всё ещё совпадает с прошлым уроком", () => {
    expect(nextBoardTitleOnLessonChange({
      currentTitle: "Урок по алгоритмам",
      previousLessonTitle: "Урок по алгоритмам",
      nextLessonTitle: "Графы",
    })).toBe("Графы");
  });

  it("не затирает название, которое учитель уже изменил", () => {
    expect(nextBoardTitleOnLessonChange({
      currentTitle: "Черновик схем",
      previousLessonTitle: "Урок по алгоритмам",
      nextLessonTitle: "Графы",
    })).toBe("Черновик схем");
  });
});
