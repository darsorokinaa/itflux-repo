import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import HomeworkNotebookEditor from "./HomeworkNotebookEditor";
import { createAnnotation } from "./notebookModel";

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null);
});

const page = {
  id: "p1",
  page_number: 1,
  page_type: "blank",
  width: 1000,
  height: 1414,
  state: { version: 1, objects: [] },
};

function renderNotebook(document, props = {}) {
  return render(
    <MemoryRouter>
      <HomeworkNotebookEditor
        publishedPayload={{ document }}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe("review notebook chrome", () => {
  it("shows the page sidebar, back button and teacher comments", () => {
    const onClose = vi.fn();
    renderNotebook({
      id: "n1",
      owner_role: "teacher",
      version: 1,
      pages: [page],
    }, { onClose });

    expect(screen.getByRole("button", { name: "Назад" })).toBeTruthy();
    expect(screen.getByLabelText("Страницы тетради")).toBeTruthy();
    expect(screen.getByLabelText("Комментарии к работе")).toBeTruthy();
    expect(screen.getAllByText("Страница 1").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Назад" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps a review comment when the annotation is normalized", () => {
    const comment = createAnnotation("comment", { text: "Проверь знак", resolved: true }, "p1");
    expect(comment.type).toBe("comment");
    expect(comment.text).toBe("Проверь знак");
    expect(comment.resolved).toBe(true);
  });
});
