/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomeUpdatesBlock from "./HomeUpdatesBlock";

function mockMatchMedia(width: number) {
  window.innerWidth = width;
  window.matchMedia = (query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const matches = min ? width >= Number(min[1]) : false;
    return {
      matches,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    };
  };
}

function updates(...titles: string[]) {
  return titles.map((title, index) => ({
    id: index + 1,
    title,
    description: `Текст ${index + 1}`,
    url: index % 2 === 0 ? "/cabinet" : "",
    link_text: "",
  }));
}

function mockFetch(payload: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      json: async () => payload,
    }),
  );
}

describe("HomeUpdates", () => {
  beforeEach(() => {
    mockMatchMedia(1280);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders nothing while empty", async () => {
    mockFetch({ updates: [] });
    const { container } = render(<HomeUpdatesBlock />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it("hides arrows when there are 3 or fewer items on desktop", async () => {
    mockFetch({ updates: updates("A", "B", "C") });
    render(<HomeUpdatesBlock />);
    expect(await screen.findByRole("region", { name: "Обновления" })).toBeTruthy();
    expect(screen.getAllByText(/^A$|^B$|^C$/)).toHaveLength(3);
    expect(screen.queryByLabelText("Предыдущие обновления")).toBeNull();
    expect(screen.queryByLabelText("Следующие обновления")).toBeNull();
  });

  it("pages by groups of three and keeps a short last page", async () => {
    mockFetch({ updates: updates("1", "2", "3", "4") });
    render(<HomeUpdatesBlock />);
    expect(await screen.findByText("1")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();

    const prev = screen.getByLabelText("Предыдущие обновления") as HTMLButtonElement;
    const next = screen.getByLabelText("Следующие обновления") as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(false);

    fireEvent.click(next);
    expect(prev.disabled).toBe(false);
    expect(next.disabled).toBe(true);

    fireEvent.click(prev);
    expect(prev.disabled).toBe(true);
  });

  it("makes the whole card a link only when a url exists", async () => {
    mockFetch({
      updates: [
        { id: 1, title: "Со ссылкой", description: "Есть", url: "/cabinet", link_text: "Открыть" },
        { id: 2, title: "Без ссылки", description: "Нет", url: "", link_text: "" },
      ],
    });
    render(<HomeUpdatesBlock />);
    const linked = await screen.findByRole("link", { name: /Со ссылкой/ });
    expect(linked.getAttribute("href")).toBe("/cabinet");
    expect(screen.getByText("Открыть")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Без ссылки/ })).toBeNull();
    expect(screen.getByText("Без ссылки").closest("article")).toBeTruthy();
  });

  it("pages by one card on mobile", async () => {
    mockMatchMedia(375);
    mockFetch({ updates: updates("A", "B") });
    render(<HomeUpdatesBlock />);
    const next = await screen.findByLabelText("Следующие обновления") as HTMLButtonElement;
    fireEvent.click(next);
    expect(next.disabled).toBe(true);
  });
});
