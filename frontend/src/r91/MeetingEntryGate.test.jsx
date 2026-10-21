import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import MeetingEntryGate from "./MeetingEntryGate";

vi.mock("../components/SocialLoginButtons", () => ({ default: ({ nextPath }) => <div data-testid="social" data-next={nextPath} /> }));

function mockFetch(payload, ok = true) {
  globalThis.fetch = vi.fn(async () => ({ ok, status: ok ? 200 : 404, json: async () => payload }));
}
const U = "11111111-2222-3333-4444-555555555555";
function renderGate() {
  return render(
    <MemoryRouter initialEntries={[`/cabinet/meetings/${U}`]}>
      <Routes>
        <Route path="/cabinet/meetings/:id" element={<MeetingEntryGate meetingUuid={U}><div data-testid="room" /></MeetingEntryGate>} />
        <Route path="/cabinet/meetings/next-one" element={<div data-testid="next" />} />
      </Routes>
    </MemoryRouter>,
  );
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("MeetingEntryGate (r91)", () => {
  it("logged out: shows student login prompt with masked hint and keeps next", async () => {
    mockFetch({ authenticated: false, finished: false, student_email_hint: "ni***@gmail.com" });
    renderGate();
    expect(await screen.findByText("Войдите в аккаунт ученика")).toBeTruthy();
    expect(screen.getByText("ni***@gmail.com")).toBeTruthy();
    expect(screen.getByText("Войти по email и паролю").getAttribute("href")).toContain(encodeURIComponent(`/cabinet/meetings/${U}`));
    expect(screen.getByTestId("social").dataset.next).toBe(`/cabinet/meetings/${U}`);
    expect(screen.queryByTestId("room")).toBeNull();
  });
  it("finished lesson of series: redirects to next lesson", async () => {
    mockFetch({ authenticated: true, redirect: "/cabinet/meetings/next-one" });
    renderGate();
    expect(await screen.findByTestId("next")).toBeTruthy();
  });
  it("finished without next: clear message", async () => {
    mockFetch({ authenticated: true, finished_no_next: true });
    renderGate();
    expect(await screen.findByText("Этот урок уже завершён")).toBeTruthy();
  });
  it("normal / api error: renders room", async () => {
    mockFetch({}, false);
    renderGate();
    await waitFor(() => expect(screen.getByTestId("room")).toBeTruthy());
  });
});
