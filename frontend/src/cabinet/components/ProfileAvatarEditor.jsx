import { useEffect, useRef, useState } from "react";
import { deleteProfileAvatar, uploadProfileAvatar } from "../../utils/cabinetAuth";

function initialsFrom(name) {
  const trimmed = (name || "").trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
}

/**
 * Загрузка / смена / удаление аватара профиля (учитель и ученик).
 */
export default function ProfileAvatarEditor({
  avatarUrl = "",
  displayName = "",
  onChanged,
  size = "md",
}) {
  const inputRef = useRef(null);
  const [shownUrl, setShownUrl] = useState(avatarUrl || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setShownUrl(avatarUrl || "");
  }, [avatarUrl]);

  const letter = initialsFrom(displayName);

  const handlePick = () => {
    if (busy) return;
    inputRef.current?.click();
  };

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const data = await uploadProfileAvatar(file);
      const next = data?.avatar || "";
      setShownUrl(next);
      if (typeof onChanged === "function") await onChanged(next);
    } catch (err) {
      setError(err?.message || "Не удалось загрузить аватар");
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await deleteProfileAvatar();
      setShownUrl("");
      if (typeof onChanged === "function") await onChanged("");
    } catch (err) {
      setError(err?.message || "Не удалось удалить аватар");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`cb-avatar-editor cb-avatar-editor--${size}`}>
      <button
        type="button"
        className={`cb-avatar-editor__face${shownUrl ? " cb-avatar-editor__face--photo" : ""}`}
        onClick={handlePick}
        disabled={busy}
        aria-label="Загрузить аватар"
        title="Загрузить аватар"
      >
        {shownUrl ? (
          <img src={shownUrl} alt="" className="cb-avatar-editor__img" />
        ) : (
          <span aria-hidden="true">{letter}</span>
        )}
      </button>
      <div className="cb-avatar-editor__actions">
        <button type="button" className="cb-btn cb-btn--outline cb-btn--sm" onClick={handlePick} disabled={busy}>
          {busy ? "…" : (shownUrl ? "Сменить" : "Добавить фото")}
        </button>
        {shownUrl ? (
          <button
            type="button"
            className="cb-btn cb-btn--ghost cb-btn--sm cb-avatar-editor__remove"
            onClick={handleRemove}
            disabled={busy}
          >
            Удалить
          </button>
        ) : null}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="cb-avatar-editor__input"
        onChange={handleFile}
      />
      {error ? <p className="cb-avatar-editor__error" role="alert">{error}</p> : null}
    </div>
  );
}

export function UserAvatarMark({ user, className = "", fallbackName = "" }) {
  const url = user?.avatar || "";
  const letter = initialsFrom(fallbackName || user?.name || user?.display_name || "?");
  if (url) {
    return (
      <>
        <img src={url} alt="" className="cabinet-user-avatar__img" />
      </>
    );
  }
  return letter;
}
