/** Кнопка PDF в тулбаре Excalidraw — рядом с инструментом изображения. */

export const BOARD_PDF_TOOL_TESTID = "toolbar-pdf";

const PDF_ICON = `
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
    <path d="M8 13h8" />
    <path d="M8 17h5" />
  </svg>
`.trim();

export function findBoardPdfToolbarSlot(root: ParentNode): {
  toolbar: Element;
  after: Element | null;
} | null {
  const mobile = root.querySelector(".App-toolbar--mobile");
  const desktop = root.querySelector(".App-toolbar:not(.App-toolbar--mobile)");
  const toolbar = mobile || desktop || root.querySelector(".App-toolbar");
  if (!toolbar) return null;

  const image = toolbar.querySelector('[data-testid="toolbar-image"]');
  if (image) {
    return { toolbar, after: image.closest("label, .ToolIcon") || image };
  }
  const extra = toolbar.querySelector(
    '[data-testid="extra-tools-icon"], .App-toolbar__extra-tools-trigger, [data-testid="toolbar-frame"]',
  );
  if (extra) {
    const wrap = extra.closest("label, .ToolIcon, button") || extra;
    return { toolbar, after: wrap.previousElementSibling };
  }
  return { toolbar, after: toolbar.lastElementChild };
}

export function insertBoardPdfToolbarButton(
  slot: { toolbar: Element; after: Element | null },
  button: HTMLElement,
): void {
  if (slot.toolbar.querySelector(`[data-testid="${BOARD_PDF_TOOL_TESTID}"]`)) return;
  if (slot.after?.parentElement) {
    slot.after.insertAdjacentElement("afterend", button);
    return;
  }
  slot.toolbar.appendChild(button);
}

export function createBoardPdfToolbarButton(onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ToolIcon ToolIcon_type_button cb-board-pdf-tool";
  button.dataset.testid = BOARD_PDF_TOOL_TESTID;
  button.title = "Добавить PDF";
  button.setAttribute("aria-label", "Добавить PDF");
  button.innerHTML = `<div class="ToolIcon__icon">${PDF_ICON}</div>`;
  const handle = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  };
  button.addEventListener("click", handle);
  button.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
  return button;
}

export function mountBoardPdfToolbar(
  host: Element,
  opts: { onClick: () => void; enabled: boolean },
): () => void {
  if (!opts.enabled || typeof MutationObserver === "undefined") return () => {};

  let button: HTMLButtonElement | null = null;
  let attaching = false;

  const ensure = () => {
    if (attaching) return;
    const slot = findBoardPdfToolbarSlot(host);
    if (!slot) return;
    if (slot.toolbar.querySelector(`[data-testid="${BOARD_PDF_TOOL_TESTID}"]`)) return;
    attaching = true;
    try {
      if (!button) button = createBoardPdfToolbarButton(opts.onClick);
      insertBoardPdfToolbarButton(slot, button);
    } finally {
      attaching = false;
    }
  };

  ensure();
  const observer = new MutationObserver(ensure);
  observer.observe(host, { childList: true, subtree: true });
  const timers = [40, 160, 500, 1400].map((ms) => window.setTimeout(ensure, ms));

  return () => {
    observer.disconnect();
    timers.forEach((id) => window.clearTimeout(id));
    button?.remove();
    button = null;
  };
}
