const PIP_STYLES = `
html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  background: #0f172a;
  overflow: hidden;
}
body {
  font-family: Inter, system-ui, sans-serif;
}
.ss-ann-v2-pip-body {
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  min-height: 100%;
}
.ss-ann-v2-pip-body .ss-ann-v2-toolbar {
  width: 100%;
  border-radius: 0;
  box-shadow: none;
}
`;

export const ANNOTATION_PIP_SIZE = Object.freeze({
  width: 860,
  height: 96,
});

function copyStyleSheets(fromDoc, toDoc) {
  try {
    if (fromDoc.adoptedStyleSheets?.length && toDoc.adoptedStyleSheets !== undefined) {
      toDoc.adoptedStyleSheets = [...fromDoc.adoptedStyleSheets];
    }
  } catch {
    /* ignore */
  }
  try {
    for (const node of fromDoc.querySelectorAll("link[rel=\"stylesheet\"], style")) {
      try {
        toDoc.head.appendChild(node.cloneNode(true));
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  try {
    const extra = toDoc.createElement("style");
    extra.textContent = PIP_STYLES;
    toDoc.head.appendChild(extra);
  } catch {
    /* ignore */
  }
}

export function documentPipAvailable() {
  return typeof window !== "undefined"
    && Boolean(window.documentPictureInPicture)
    && typeof window.documentPictureInPicture.requestWindow === "function";
}

/**
 * Compact always-on-top toolbar window (Chrome Document Picture-in-Picture).
 * Must be called from a user gesture. Not a canvas over other apps.
 */
export async function openDocumentPipWindow({
  width = ANNOTATION_PIP_SIZE.width,
  height = ANNOTATION_PIP_SIZE.height,
} = {}) {
  if (!documentPipAvailable()) return null;
  try {
    const pipWindow = await window.documentPictureInPicture.requestWindow({
      width,
      height,
      disallowReturnToOpener: false,
    });
    copyStyleSheets(document, pipWindow.document);
    pipWindow.document.body.className = "ss-ann-v2-pip-body";
    return pipWindow;
  } catch {
    return null;
  }
}

export function closeDocumentPipWindow(pipWindow) {
  if (!pipWindow) return;
  try {
    if (!pipWindow.closed) pipWindow.close();
  } catch {
    /* ignore */
  }
}

export function bindPipWindowClose(pipWindow, onClose) {
  if (!pipWindow || typeof onClose !== "function") return () => {};
  const handler = () => onClose();
  try {
    pipWindow.addEventListener("pagehide", handler);
  } catch {
    return () => {};
  }
  return () => {
    try {
      pipWindow.removeEventListener("pagehide", handler);
    } catch {
      /* ignore */
    }
  };
}
