import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import ConnectionCheckModal from "./ConnectionCheckModal";
import { stopAllConnectionCheckStreams } from "./mediaCleanup";
import { clearPrimedMedia } from "./mediaDevices";
import {
  CONNECTION_CHECK_CLOSE_EVENT,
  CONNECTION_CHECK_OPEN_EVENT,
} from "./openConnectionCheck";

function isInternalHref(href) {
  return typeof href === "string" && href.startsWith("/");
}

export default function ConnectionCheckHost() {
  const navigate = useNavigate();
  const location = useLocation();
  const [session, setSession] = useState(null);
  const [sessionPath, setSessionPath] = useState(location.pathname);

  if (sessionPath !== location.pathname) {
    setSessionPath(location.pathname);
    if (session) {
      clearPrimedMedia();
      stopAllConnectionCheckStreams();
      setSession(null);
    }
  }

  const close = useCallback(() => {
    clearPrimedMedia();
    stopAllConnectionCheckStreams();
    setSession(null);
  }, []);

  useEffect(() => {
    const onOpen = (event) => {
      setSession(event.detail || {});
    };
    const onClose = () => close();
    window.addEventListener(CONNECTION_CHECK_OPEN_EVENT, onOpen);
    window.addEventListener(CONNECTION_CHECK_CLOSE_EVENT, onClose);
    return () => {
      window.removeEventListener(CONNECTION_CHECK_OPEN_EVENT, onOpen);
      window.removeEventListener(CONNECTION_CHECK_CLOSE_EVENT, onClose);
    };
  }, [close]);

  const options = session || {};
  const open = Boolean(session);

  const handleJoin = () => {
    const { joinHref, onJoin } = options;
    close();
    if (typeof onJoin === "function") {
      onJoin();
      return;
    }
    if (!joinHref) return;
    if (isInternalHref(joinHref)) {
      navigate(joinHref);
      return;
    }
    window.open(joinHref, "_blank", "noopener,noreferrer");
  };

  return (
    <ConnectionCheckModal
      open={open}
      onClose={close}
      canJoin={Boolean(options.canJoin && (options.joinHref || options.onJoin))}
      joinLabel={options.joinLabel || "Перейти в урок"}
      onJoin={handleJoin}
    />
  );
}
