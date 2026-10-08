import { describe, expect, it } from "vitest";

import { extraHomeworkText, visibleHomeworkResourceTasks } from "./homeworkTaskDisplay";

describe("visibleHomeworkResourceTasks", () => {
  it("keeps two tasks with the same title and text", () => {
    const tasks = [
      { id: 1, title: "Тренажёр", description: "Одинаковое условие", task_type: "text" },
      { id: 2, title: "Тренажёр", description: "Одинаковое условие", task_type: "text" },
    ];
    expect(visibleHomeworkResourceTasks(tasks).map((task) => task.id)).toEqual([1, 2]);
  });

  it("keeps two links to the same variant", () => {
    const tasks = [
      {
        id: 7,
        title: "Вариант",
        description: "/oge/inf/variant/5",
        open_url: "/oge/inf/variant/5?cabinet_assignment=1",
        task_type: "generated_task",
        is_variant: true,
        variant_id: 5,
      },
      {
        id: 8,
        title: "Вариант",
        description: "/oge/inf/variant/5",
        open_url: "/oge/inf/variant/5?cabinet_assignment=1",
        task_type: "generated_task",
        is_variant: true,
        variant_id: 5,
      },
    ];
    expect(visibleHomeworkResourceTasks(tasks).map((task) => task.id)).toEqual([7, 8]);
  });

  it("hides an instruction copy and a file that repeats an attachment", () => {
    const tasks = [
      { id: 1, title: "Домашнее задание", description: "Решите", task_type: "text" },
      { id: 2, title: "Тренажёр", description: "Своё условие", task_type: "text" },
      {
        id: 3,
        title: "A4.pdf",
        description: "/files/a4.pdf",
        file_url: "/files/a4.pdf",
        task_type: "file",
      },
    ];
    const visible = visibleHomeworkResourceTasks(tasks, {
      description: "Решите",
      attachments: [{ name: "A4.pdf", url: "/files/a4.pdf" }],
    });
    expect(visible.map((task) => task.id)).toEqual([2]);
    expect(extraHomeworkText(tasks, "Решите")).toBe("Решите");
  });
});
