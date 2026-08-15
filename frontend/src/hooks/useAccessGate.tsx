import { useCallback, useEffect, useState } from "react";
import AccessGateModal from "../components/AccessGateModal";
import {
  classifyAccessError,
  type AccessGateContext,
  type AccessReason,
} from "../accessGate/accessGate";
import { fetchCabinetSession } from "../utils/cabinetAuth";

export function useCabinetAuthed() {
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchCabinetSession()
      .then((data) => {
        if (!cancelled) setAuthed(Boolean(data?.authenticated));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return authed;
}

type UseAccessGateOptions = {
  authenticated?: boolean;
  currentPlan?: string;
  sourcePage?: string;
};

export function useAccessGate(options: UseAccessGateOptions = {}) {
  const [ctx, setCtx] = useState<AccessGateContext | null>(null);

  const close = useCallback(() => setCtx(null), []);

  const openGate = useCallback((next: AccessGateContext) => {
    setCtx(next);
  }, []);

  const openFromError = useCallback(
    (input: unknown, extras: Partial<AccessGateContext> = {}) => {
      const classified = classifyAccessError(input, {
        currentPlan: options.currentPlan,
        sourcePage: options.sourcePage,
        ...extras,
      });
      if (!classified) return false;
      if (!options.authenticated && classified.reason !== "anonymous") {
        if (classified.reason === "insufficient_plan" || classified.reason === "feature_not_in_plan") {
          setCtx({ ...classified, reason: "anonymous" as AccessReason });
          return true;
        }
      }
      if (options.authenticated && classified.reason === "anonymous" && !String(classified.resourceType).match(/variant|workbook/)) {
        setCtx({ ...classified, reason: "insufficient_plan" });
        return true;
      }
      setCtx(classified);
      return true;
    },
    [options.authenticated, options.currentPlan, options.sourcePage],
  );

  const modal = (
    <AccessGateModal
      open={Boolean(ctx)}
      onClose={close}
      reason={ctx?.reason || "anonymous"}
      resourceType={ctx?.resourceType || "content"}
      resourceName={ctx?.resourceName}
      resourceId={ctx?.resourceId}
      requiredPlan={ctx?.requiredPlan}
      currentPlan={ctx?.currentPlan || options.currentPlan}
      sourcePage={ctx?.sourcePage || options.sourcePage}
      returnUrl={ctx?.returnUrl}
      authenticated={Boolean(options.authenticated) && ctx?.reason !== "anonymous"}
    />
  );

  return { modal, openFromError, openGate, close, open: Boolean(ctx) };
}
