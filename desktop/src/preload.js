import { contextBridge } from "electron";
import { install } from "@jitsi/electron-sdk/preload";
import { isTrustedDesktopURL, isUnpackagedElectronProcess } from "./trustedOrigins.cjs";

if (isTrustedDesktopURL(location.href, { allowHttpLocalhost: isUnpackagedElectronProcess() })) {
  install();
  contextBridge.exposeInMainWorld("itfluxDesktop", {
    isDesktopClient: true,
    remoteControlSupported: true,
  });
}
