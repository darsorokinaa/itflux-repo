/** Толщина штриха: slider в боковой панели свойств (как непрозрачность). */

import {
  BOARD_STROKE_SLIDER_MAX,
  clampBoardStrokeWidth,
  sliderToStrokeWidth,
  strokeWidthToSlider,
  withBoardStrokeWidthDefault,
} from "./boardStrokeWidth";

export const BOARD_STROKE_WIDTH_PANEL_TESTID = "panel-stroke-width";

export type BoardStrokeWidthToolbarHandle = {
  sync: (width: unknown) => void;
  unmount: () => void;
};

export function findBoardStrokeWidthFieldset(root: ParentNode): HTMLElement | null {
  const thin =
    root.querySelector(".selected-shape-actions [data-testid='strokeWidth-thin']") ||
    root.querySelector("[data-testid='strokeWidth-thin']");
  return (thin?.closest("fieldset") as HTMLElement | null) || null;
}

export function insertBoardStrokeWidthPanel(fieldset: HTMLElement, node: HTMLElement): void {
  if (fieldset.querySelector(`[data-testid="${BOARD_STROKE_WIDTH_PANEL_TESTID}"]`)) return;
  fieldset.appendChild(node);
}

function stopPanelGesture(event: Event) {
  event.stopPropagation();
}

function paintRangeTrack(slider: HTMLInputElement, sliderValue: number) {
  const t = Number.isFinite(sliderValue) ? sliderValue : 0;
  slider.style.background = `linear-gradient(to right, var(--color-slider-track) 0%, var(--color-slider-track) ${t}%, var(--button-bg) ${t}%, var(--button-bg) 100%)`;
}

export function createBoardStrokeWidthPanel(opts: {
  getWidth: () => unknown;
  setWidth: (width: number, commit: boolean) => void;
}): { node: HTMLElement; sync: (raw: unknown) => void; destroy: () => void } {
  const wrap = document.createElement("div");
  wrap.className = "cb-board-stroke-panel";
  wrap.dataset.testid = BOARD_STROKE_WIDTH_PANEL_TESTID;

  const range = document.createElement("div");
  range.className = "range-wrapper";

  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "range-input";
  slider.min = "0";
  slider.max = String(BOARD_STROKE_SLIDER_MAX);
  slider.step = "1";
  slider.setAttribute("aria-label", "Толщина штриха");

  const zero = document.createElement("div");
  zero.className = "zero-label";
  zero.textContent = "0";
  const max = document.createElement("div");
  max.className = "cb-board-stroke-panel__max";
  max.textContent = String(BOARD_STROKE_SLIDER_MAX);

  range.append(slider, zero, max);
  wrap.appendChild(range);

  const applyVisual = (width: number) => {
    const w = clampBoardStrokeWidth(width);
    const sliderValue = strokeWidthToSlider(w);
    const asString = String(sliderValue);
    if (slider.value !== asString) slider.value = asString;
    paintRangeTrack(slider, sliderValue);
  };

  applyVisual(withBoardStrokeWidthDefault(opts.getWidth()));

  slider.addEventListener("input", () => {
    const width = sliderToStrokeWidth(Number(slider.value));
    applyVisual(width);
    opts.setWidth(width, false);
  });
  slider.addEventListener("change", () => {
    const width = sliderToStrokeWidth(Number(slider.value));
    applyVisual(width);
    opts.setWidth(width, true);
  });
  wrap.addEventListener("pointerdown", stopPanelGesture);
  wrap.addEventListener("pointermove", stopPanelGesture);
  wrap.addEventListener("touchstart", stopPanelGesture);

  return {
    node: wrap,
    sync: (raw) => applyVisual(withBoardStrokeWidthDefault(raw)),
    destroy: () => {
      wrap.remove();
    },
  };
}

export function mountBoardStrokeWidthControl(
  host: Element,
  opts: {
    enabled: boolean;
    getWidth: () => unknown;
    setWidth: (width: number, commit: boolean) => void;
  },
): BoardStrokeWidthToolbarHandle {
  const noop: BoardStrokeWidthToolbarHandle = { sync: () => {}, unmount: () => {} };
  if (!opts.enabled || typeof MutationObserver === "undefined") return noop;

  let panel: ReturnType<typeof createBoardStrokeWidthPanel> | null = null;
  let attaching = false;

  const ensure = () => {
    if (attaching) return;
    attaching = true;
    try {
      const fieldset = findBoardStrokeWidthFieldset(host);
      if (!fieldset) return;
      if (!panel) panel = createBoardStrokeWidthPanel(opts);
      insertBoardStrokeWidthPanel(fieldset, panel.node);
    } finally {
      attaching = false;
    }
  };

  ensure();
  const observer = new MutationObserver(ensure);
  observer.observe(host, { childList: true, subtree: true });

  return {
    sync: (width) => {
      panel?.sync(width);
    },
    unmount: () => {
      observer.disconnect();
      panel?.destroy();
      panel = null;
    },
  };
}
