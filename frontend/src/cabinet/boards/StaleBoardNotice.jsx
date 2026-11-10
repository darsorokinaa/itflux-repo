import { useEffect } from "react";

import { canAutoReloadBoardTab, reloadBoardTab, STALE_BOARD_TITLE } from "../../utils/boardTabReload";
import { recoverChunkLoadOnce } from "../../utils/clientTelemetry";
import LessonBoardMessage from "./LessonBoardMessage";

/** Shown when WebKit kept a stale board chunk after a deploy. */
export default function StaleBoardNotice() {
  useEffect(() => {
    if (!canAutoReloadBoardTab()) return;
    recoverChunkLoadOnce();
  }, []);

  return (
    <LessonBoardMessage
      title={STALE_BOARD_TITLE}
      onRetry={() => reloadBoardTab()}
      retryLabel="Перезагрузить вкладку"
    />
  );
}
