import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { PALETTE, TOOLS, participantColor } from "../screenshare/constants";

const AnnotationContext = createContext(null);

export function resolveAnnotationTarget({
  enabled = false,
  screenshareActive = false,
  materialAnnotatable = false,
  workspaceOpen = false,
  focusCall = false,
} = {}) {
  if (!enabled) return "none";
  const onMaterial = Boolean(workspaceOpen && !focusCall && materialAnnotatable);
  if (onMaterial) return "material";
  if (screenshareActive) return "screenshare";
  if (materialAnnotatable) return "material";
  return "none";
}

export function AnnotationProvider({
  children,
  screenshareActive = false,
  materialAnnotatable = false,
  workspaceOpen = false,
  focusCall = false,
  canAnnotate = false,
  canManage = false,
  currentUserId = null,
}) {
  const [enabled, setEnabled] = useState(false);
  const [tool, setTool] = useState(TOOLS.PEN);
  const [color, setColor] = useState(() => participantColor(currentUserId));
  const [width, setWidth] = useState(3);

  useEffect(() => {
    setColor((prev) => (PALETTE.includes(prev) ? prev : participantColor(currentUserId)));
  }, [currentUserId]);

  const available = Boolean(screenshareActive || materialAnnotatable);
  const target = useMemo(
    () => resolveAnnotationTarget({
      enabled,
      screenshareActive,
      materialAnnotatable,
      workspaceOpen,
      focusCall,
    }),
    [enabled, screenshareActive, materialAnnotatable, workspaceOpen, focusCall],
  );

  useEffect(() => {
    if (enabled && !available) setEnabled(false);
  }, [enabled, available]);

  const setEnabledSafe = useCallback((next) => {
    setEnabled((prev) => {
      const value = typeof next === "function" ? next(prev) : Boolean(next);
      if (value) {
        setTool((current) => (current === TOOLS.POINTER ? TOOLS.PEN : current));
      }
      return value;
    });
  }, []);

  const toggle = useCallback(() => {
    setEnabledSafe((prev) => !prev);
  }, [setEnabledSafe]);

  const disable = useCallback(() => setEnabled(false), []);

  const value = useMemo(() => ({
    enabled,
    setEnabled: setEnabledSafe,
    toggle,
    disable,
    target,
    tool,
    setTool,
    color,
    setColor,
    width,
    setWidth,
    canAnnotate,
    canManage,
    screenshareActive,
    materialAnnotatable,
    available,
  }), [
    available,
    canAnnotate,
    canManage,
    color,
    disable,
    enabled,
    materialAnnotatable,
    screenshareActive,
    setEnabledSafe,
    target,
    toggle,
    tool,
    width,
  ]);

  return (
    <AnnotationContext.Provider value={value}>
      {children}
    </AnnotationContext.Provider>
  );
}

export function useAnnotationSession() {
  return useContext(AnnotationContext);
}
