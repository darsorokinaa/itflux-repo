import { useState } from "react";
import {
  TldrawUiButton,
  TldrawUiButtonLabel,
  TldrawUiDialogBody,
  TldrawUiDialogCloseButton,
  TldrawUiDialogFooter,
  TldrawUiDialogHeader,
  TldrawUiDialogTitle,
  useEditor,
} from "tldraw";
import { insertLessonLink, lessonEmbedFor, normalizeLessonLink } from "./lessonEmbeds";

const EXAMPLES = [
  ["Desmos", "desmos.com/calculator/…"],
  ["GeoGebra", "geogebra.org/m/… или /calculator"],
  ["RuTube", "rutube.ru/video/…"],
  ["VK Видео", "vkvideo.ru/video-…_…"],
  ["YouTube", "youtube.com/watch?v=… (может тормозить без VPN)"],
  ["Любой сайт", "вставится как карточка-ссылка"],
];

/** r139: своя русская «Вставка» вместо англоязычного многошагового EmbedDialog tldraw. */
export default function LessonEmbedDialog({ onClose }) {
  const editor = useEditor();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const url = normalizeLessonLink(value);
  const match = url ? lessonEmbedFor(url) : null;
  const hint = !value.trim()
    ? ""
    : !url
      ? "Это не похоже на ссылку"
      : match
        ? `Будет встроено: ${match.definition.title}`
        : "Будет вставлено как ссылка-закладка";

  async function submit(event) {
    event?.preventDefault();
    if (!url || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await insertLessonLink(editor, value);
      if (!res.ok) {
        setError("Не удалось распознать ссылку");
        return;
      }
      onClose();
    } catch (e) {
      console.error("[lesson-embed]", e);
      setError("Не удалось вставить. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <TldrawUiDialogHeader>
        <TldrawUiDialogTitle>Вставка с сайта</TldrawUiDialogTitle>
        <TldrawUiDialogCloseButton />
      </TldrawUiDialogHeader>
      <TldrawUiDialogBody style={{ maxWidth: 420 }}>
        <form onSubmit={submit} className="lesson-embed-dialog">
          <label className="lesson-embed-dialog__label" htmlFor="lesson-embed-url">Ссылка или код &lt;iframe&gt;</label>
          <input
            id="lesson-embed-url"
            className="tlui-input lesson-embed-dialog__input"
            data-testid="lesson-embed-input"
            autoFocus
            placeholder="https://www.desmos.com/calculator"
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(""); }}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <p className="lesson-embed-dialog__hint" role="status">{error || hint}</p>
          <ul className="lesson-embed-dialog__list">
            {EXAMPLES.map(([name, sample]) => (
              <li key={name}><b>{name}</b> — {sample}</li>
            ))}
          </ul>
        </form>
      </TldrawUiDialogBody>
      <TldrawUiDialogFooter className="tlui-dialog__footer__actions">
        <TldrawUiButton type="normal" onClick={onClose}><TldrawUiButtonLabel>Отмена</TldrawUiButtonLabel></TldrawUiButton>
        <TldrawUiButton type="primary" data-testid="lesson-embed-submit" disabled={!url || busy} onClick={submit}>
          <TldrawUiButtonLabel>{busy ? "Вставляем…" : "Вставить"}</TldrawUiButtonLabel>
        </TldrawUiButton>
      </TldrawUiDialogFooter>
    </>
  );
}
