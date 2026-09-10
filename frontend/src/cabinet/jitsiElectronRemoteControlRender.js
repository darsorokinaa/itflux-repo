import { setupRemoteControlRender } from "@jitsi/electron-sdk/renderer";

/** Official SDK v10 renderer entry. Called only with the live JitsiMeetExternalAPI. */
export function getJitsiElectronRemoteControlSetup() {
  return setupRemoteControlRender;
}
