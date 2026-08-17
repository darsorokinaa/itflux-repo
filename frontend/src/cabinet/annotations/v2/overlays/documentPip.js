const PIP_STYLES = `
html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
body { font-family: Inter, system-ui, sans-serif; }
`;

function copyStyleSheets(fromDoc, toDoc) {
  try {
    if (fromDoc.adoptedStyleSheets?.length && toDoc.adoptedStyleSheets !== undefined) {
      toDoc.adoptedStyleSheets = [...fromDoc.adoptedStyleSheets];
    }
  } catch {
    /* ignore */
  }
  for (const node of fromDoc.querySelectorAll("link[rel=\"stylesheet\"], style")) {
    try {
      toDoc.head.appendChild(node.cloneNode(true));
    } catch {
      /* ignore */
    }
  }
  const extra = toDoc.createElement("style");
  extra.textContent = PIP_STYLES;
  toDoc.head.appendChild(extra);
}

export function documentPipAvailable() {
  return typeof window !== "undefined"
    && Boolean(window.documentPictureInPicture)
    && typeof window.documentPictureInPicture.requestWindow === "function";
}

/**
 * Compact always-on-top toolbar window. Not a canvas over PowerPoint.
 */
export async function openDocumentPipWindow({ width = 520, height = 72 } = {}) {
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
    pipWindow.close();
  } catch {
    /* ignore */
  }
}
