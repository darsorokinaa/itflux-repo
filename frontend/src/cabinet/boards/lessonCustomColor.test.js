import { describe, expect, it } from "vitest";
import { DefaultColorStyle, geoShapeProps } from "@tldraw/tlschema";

import { LESSON_CUSTOM_COLOR, acceptLessonCustomColors } from "./lessonCustomColor";

describe("lesson custom colors", () => {
  it("keeps c###### valid after the theme rebuilds the color enum", () => {
    acceptLessonCustomColors(DefaultColorStyle);
    acceptLessonCustomColors(geoShapeProps.labelColor);
    DefaultColorStyle.addValues("black");
    geoShapeProps.labelColor.removeValues("c0e7f06");
    expect(LESSON_CUSTOM_COLOR.test("c0e7f06")).toBe(true);
    expect(DefaultColorStyle.validate("c0e7f06")).toBe("c0e7f06");
    expect(geoShapeProps.labelColor.validate("c0e7f06")).toBe("c0e7f06");
    expect(DefaultColorStyle.validate("black")).toBe("black");
    expect(() => DefaultColorStyle.validate("not-a-color")).toThrow();
  });
});