import { useAccessGate, useCabinetAuthed } from "./useAccessGate";

/** @deprecated use useAccessGate — оставлен как тонкая обёртка для генератора. */
export function useAnonLimitModal() {
  const authenticated = useCabinetAuthed();
  return useAccessGate({ authenticated });
}
