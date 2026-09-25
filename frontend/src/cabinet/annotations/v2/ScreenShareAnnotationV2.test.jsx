/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import ScreenShareAnnotationV2 from "./ScreenShareAnnotationV2";

afterEach(() => {
  cleanup();
  delete window.documentPictureInPicture;
});

describe("ScreenShareAnnotationV2 zoom UX", () => {
  it("does not show an annotations button on the call when sharing starts", () => {
    render(
      <ScreenShareAnnotationV2
        active
        canAnnotate
        canManage
        currentUserId={1}
      />,
    );
    expect(screen.queryByRole("button", { name: "Аннотации" })).toBeNull();
    expect(screen.queryByRole("toolbar", { name: "Аннотации демонстрации экрана" })).toBeNull();
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

  it("unmounts the overlay when sharing stops", () => {
    const { rerender } = render(
      <ScreenShareAnnotationV2
        active
        canAnnotate
        canManage
        currentUserId={1}
        contentWidth={1920}
        contentHeight={1080}
      />,
    );
    expect(screen.queryByRole("button", { name: "Аннотации" })).toBeNull();
    rerender(
      <ScreenShareAnnotationV2
        active={false}
        canAnnotate
        canManage
        currentUserId={1}
      />,
    );
    expect(document.querySelector(".ss-ann-v2-canvas")).toBeNull();
    expect(document.querySelector(".ss-ann-v2-toolbar-slot")).toBeNull();
  });

  it("does not mount a drawing canvas without a share host or exact geometry", () => {
    render(
      <ScreenShareAnnotationV2
        active
        canAnnotate
        canManage
        currentUserId={1}
        contentWidth={1920}
        contentHeight={1080}
      />,
    );
    expect(document.querySelector(".ss-ann-v2-canvas")).toBeNull();
  });

  it("enables pen before exact Jitsi geometry so lines can be drawn", () => {
    render(
      <ScreenShareAnnotationV2
        active
        canAnnotate
        canManage
        currentUserId={1}
      />,
    );
    fireEvent(window, new Event("itflux-ss-ann-open"));
    expect(screen.getByRole("button", { name: "Перо" }).disabled).toBe(false);
  });

  it("mounts a fixed canvas over the share host so strokes are visible", async () => {
    const host = document.createElement("div");
    host.getBoundingClientRect = () => ({
      left: 40,
      top: 80,
      width: 960,
      height: 540,
      right: 1000,
      bottom: 620,
    });
    document.body.appendChild(host);
    render(
      <ScreenShareAnnotationV2
        active
        canAnnotate
        canManage
        currentUserId={1}
        contentWidth={1920}
        contentHeight={1080}
        targetRef={{ current: host }}
      />,
    );
    fireEvent(window, new Event("itflux-ss-ann-open"));
    fireEvent.click(screen.getByRole("button", { name: "Перо" }));
    await waitFor(() => {
      expect(document.querySelector(".ss-ann-v2-canvas")).toBeTruthy();
    });
    const canvas = document.querySelector(".ss-ann-v2-canvas");
    expect(canvas.style.position).toBe("fixed");
    expect(canvas.classList.contains("is-drawing")).toBe(true);
    host.remove();
  });
});
