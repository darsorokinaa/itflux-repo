/** Ластик снимает штрих поверх картинки и не трогает саму картинку. */

const guarded = new WeakSet();

export function withoutImageEraseTargets(shapes, typeOf) {
  if (!Array.isArray(shapes)) return [];
  return shapes.filter((item) => {
    const id = item && typeof item === "object" ? item.id : item;
    return typeOf(id) !== "image";
  });
}

export function imageSurvivesEraser(shape, source, erasing) {
  return Boolean(erasing && source === "user" && shape?.type === "image");
}

export function keepImagesUnderEraser(editor) {
  if (!editor || guarded.has(editor)) return () => {};
  guarded.add(editor);
  const original = editor.setErasingShapes.bind(editor);
  editor.setErasingShapes = (shapes) => original(
    withoutImageEraseTargets(shapes, (id) => editor.getShape?.(id)?.type),
  );
  return editor.sideEffects.registerBeforeDeleteHandler("shape", (shape, source) => {
    if (imageSurvivesEraser(shape, source, editor.isIn("eraser"))) return false;
    return undefined;
  });
}
