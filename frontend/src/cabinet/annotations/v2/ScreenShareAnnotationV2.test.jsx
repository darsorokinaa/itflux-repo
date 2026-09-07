/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import ScreenShareAnnotationV2 from "./ScreenShareAnnotationV2";

afterEach(() => {
  cleanup();
});

describe("ScreenShareAnnotationV2 zoom UX", () => {
  it("shows a compact trigger instead of the toolbar when sharing starts", () => {
    render(
      <ScreenShareAnnotationV2
        active
        canAnnotate
        canManage
        currentUserId={1}
      />,
    );
    expect(screen.getByRole("button", { name: "Аннотации" })).toBeTruthy();
    expect(screen.queryByRole("toolbar", { name: "Аннотации демонстрации экрана" })).toBeNull();
  });

  it("opens the toolbar from the trigger and keeps Pointer selected", () => {
    render(
      <ScreenShareAnnotationV2
        active
        canAnnotate
        canManage
        currentUserId={1}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Аннотации" }));
    expect(screen.getByRole("toolbar", { name: "Аннотации демонстрации экрана" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Указка" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("hides student controls until the teacher allows drawing", () => {
    render(
      <ScreenShareAnnotationV2
        active
        canAnnotate={false}
        canManage={false}
        currentUserId={2}
      />,
    );
    expect(screen.queryByRole("button", { name: "Аннотации" })).toBeNull();
    expect(screen.queryByRole("toolbar", { name: "Аннотации демонстрации экрана" })).toBeNull();
  });
});
