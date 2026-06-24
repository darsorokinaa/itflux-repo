import { createContext, useCallback, useContext, useMemo, useRef } from "react";
import {
  closeTelemostPopup,
  navigateTelemostPopup,
  openTelemostPlaceholder,
} from "./telemostPopup";

const CabinetCallContext = createContext(null);

export function CabinetCallProvider({ children }) {
  const popupRef = useRef(null);

  /** Синхронно при клике — иначе браузер откроет вкладку вместо popup. */
  const prepareCall = useCallback(() => {
    return openTelemostPlaceholder(popupRef);
  }, []);

  const openCall = useCallback((payload) => {
    const url = payload?.url;
    if (!url) return false;

    const popup = navigateTelemostPopup(popupRef, url);
    return Boolean(popup);
  }, []);

  const abortCall = useCallback(() => {
    closeTelemostPopup(popupRef);
  }, []);

  const value = useMemo(
    () => ({ prepareCall, openCall, abortCall }),
    [prepareCall, openCall, abortCall],
  );

  return (
    <CabinetCallContext.Provider value={value}>
      {children}
    </CabinetCallContext.Provider>
  );
}

export function useCabinetCall() {
  const ctx = useContext(CabinetCallContext);
  if (!ctx) {
    throw new Error("useCabinetCall must be used within CabinetCallProvider");
  }
  return ctx;
}
