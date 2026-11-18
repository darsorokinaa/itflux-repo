import { describe, expect, it } from "vitest";

import {
  CALL_AUDIO_CAPTURE,
  CALL_AUDIO_MAX_BITRATE,
  JITSI_AUDIO_QUALITY,
  liveKitAudioPublish,
} from "./callAudioQuality";

describe("call audio policy", () => {
  it("uses mono Opus around 48 kbps with RED and without DTX", () => {
    expect(CALL_AUDIO_MAX_BITRATE).toBe(48_000);
    expect(liveKitAudioPublish()).toEqual({
      audioPreset: { maxBitrate: 48_000 },
      dtx: false,
      red: true,
      forceStereo: false,
    });
    expect(JITSI_AUDIO_QUALITY).toEqual({ stereo: false, enableOpusDtx: false, opusMaxAverageBitrate: 48_000 });
  });

  it("keeps browser voice processing on", () => {
    expect(CALL_AUDIO_CAPTURE).toMatchObject({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    });
  });
});
