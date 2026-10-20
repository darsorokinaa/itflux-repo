import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { clearActiveLiveMeeting, setActiveLiveMeeting } from "../liveMeetingSession";
import PersistentMeetingHost from "./PersistentMeetingHost";

const mounts = vi.hoisted(() => ({ count: 0, unmounts: 0 }));

vi.mock("../pages/VideoMeetingPage", () => ({
  default: function FakeMeetingPage({ meetingUuid, presentation }) {
    useEffect(() => {
      mounts.count += 1;
      return () => {
        mounts.unmounts += 1;
      };
    }, []);
    return (
      <div className="video-lesson-page" data-presentation={presentation}>
        <iframe title={`jitsi-${meetingUuid}`} data-testid="jitsi" />
      </div>
    );
  },
}));

const UUID = "d81b69db-5558-4279-8fbd-7bfe018437e5";
const navRef = { current: null };
const nav = (to) => navRef.current(to);
function NavProbe() {
  const navigate = useNavigate();
  useEffect(() => {
    navRef.current = navigate;
  }, [navigate]);
  return null;
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NavProbe />
      <PersistentMeetingHost />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  clearActiveLiveMeeting();
  mounts.count = 0;
  mounts.unmounts = 0;
});

describe("PersistentMeetingHost", () => {
  it("keeps the same iframe node across SPA navigation and Back", async () => {
    renderAt(`/cabinet/meetings/${UUID}`);
    const iframe = await screen.findByTestId("jitsi");
    expect(screen.getByTestId("meeting-persist").dataset.mode).toBe("full");
    act(() => setActiveLiveMeeting(UUID));

    for (const path of ["/ege/inf/variant/1707", "/cabinet/journal/lesson/1406", "/cabinet/schedule", "/cabinet"]) {
      act(() => nav(path));
      expect(screen.getByTestId("meeting-persist").dataset.mode).toBe("mini");
      expect(screen.getByTestId("jitsi")).toBe(iframe);
    }
    act(() => nav(-1));
    act(() => nav(-1));
    expect(screen.getByTestId("jitsi")).toBe(iframe);

    fireEvent.click(screen.getByRole("button", { name: "Вернуться в урок" }));
    expect(screen.getByTestId("meeting-persist").dataset.mode).toBe("full");
    expect(screen.getByTestId("jitsi")).toBe(iframe);
    expect(mounts.count).toBe(1);
    expect(mounts.unmounts).toBe(0);
  });

  it("tears down when the live session is cleared away from the meeting", async () => {
    renderAt(`/cabinet/meetings/${UUID}`);
    await screen.findByTestId("jitsi");
    act(() => setActiveLiveMeeting(UUID));
    act(() => nav("/cabinet"));
    expect(screen.getByTestId("jitsi")).toBeTruthy();
    act(() => clearActiveLiveMeeting(UUID));
    expect(screen.queryByTestId("meeting-persist")).toBeNull();
    expect(mounts.unmounts).toBe(1);
  });

  it("does not mount a meeting on ordinary pages without a live call", () => {
    renderAt("/cabinet/schedule");
    expect(screen.queryByTestId("meeting-persist")).toBeNull();
  });
});
