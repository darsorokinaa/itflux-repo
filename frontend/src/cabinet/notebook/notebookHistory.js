const LIMIT = 80;

export function createHistory() {
  const undo = [];
  const redo = [];
  return {
    push(command) {
      if (!command) return;
      undo.push(command);
      if (undo.length > LIMIT) undo.shift();
      redo.length = 0;
    },
    canUndo() {
      return undo.length > 0;
    },
    canRedo() {
      return redo.length > 0;
    },
    undo(doc) {
      const command = undo.pop();
      if (!command) return doc;
      redo.push(command);
      return command.undo(doc);
    },
    redo(doc) {
      const command = redo.pop();
      if (!command) return doc;
      undo.push(command);
      return command.redo(doc);
    },
    clear() {
      undo.length = 0;
      redo.length = 0;
    },
  };
}

export function replaceAnnotationsCommand(pageId, before, after, type = "UPDATE_ANNOTATION") {
  return {
    type,
    undo(doc) {
      return setObjects(doc, pageId, before);
    },
    redo(doc) {
      return setObjects(doc, pageId, after);
    },
  };
}

function setObjects(doc, pageId, objects) {
  return {
    ...doc,
    pages: (doc.pages || []).map((page) => (
      page.id === pageId
        ? { ...page, state: { version: 1, objects: objects.map((item) => ({ ...item })) } }
        : page
    )),
  };
}

export function pagesCommand(beforePages, afterPages, type = "REORDER_PAGE") {
  return {
    type,
    undo(doc) {
      return { ...doc, pages: beforePages };
    },
    redo(doc) {
      return { ...doc, pages: afterPages };
    },
  };
}
