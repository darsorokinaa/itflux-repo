import { useEffect, useRef } from "react";

export const AUTO_SAVE_INTERVAL_MS = 30_000;

export function useAutoSave({
  enabled = true,
  isDirty = true,
  isSaving = false,
  onSave,
  intervalMs = AUTO_SAVE_INTERVAL_MS,
}) {
  const onSaveRef = useRef(onSave);
  const isDirtyRef = useRef(isDirty);
  const isSavingRef = useRef(isSaving);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  useEffect(() => {
    isSavingRef.current = isSaving;
  }, [isSaving]);

  useEffect(() => {
    if (!enabled) return undefined;

    const timerId = window.setInterval(() => {
      if (isSavingRef.current || !isDirtyRef.current) return;
      void onSaveRef.current?.();
    }, intervalMs);

    return () => window.clearInterval(timerId);
  }, [enabled, intervalMs]);
}
