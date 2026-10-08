import { describe, expect, it } from "vitest";

import {
  classifyReviewItem,
  mapUnsubmittedWork,
  reviewQueues,
  reviewTabCounts,
} from "./reviewUnsubmitted";

describe("mapUnsubmittedWork", () => {
  it("keeps an unsubmitted assignment out of the review queue", () => {
    const card = mapUnsubmittedWork({
      id: "hw-4-student-9",
      homework_id: 4,
      student_id: 9,
      student_name: "Ира Ученица",
      title: "Дроби",
      issued_at: "2026-10-01T10:00:00+03:00",
      due_at: "2026-10-20T18:00:00+03:00",
      status: "not_submitted",
      is_overdue: false,
      open_path: "/cabinet/homework/4/edit",
    });
    expect(card.studentName).toBe("Ира Ученица");
    expect(card.title).toBe("Дроби");
    expect(card.homeworkId).toBe(4);
    expect(card.openPath).toBe("/cabinet/homework/4/edit");
    expect(card.filter).toContain("missing");
    expect(card.filter).not.toContain("new");
    expect(card.filter).not.toContain("inbox");
    expect(card.filter).not.toContain("returned");
    expect(card.metaLine).toContain("Выдано");
    expect(card.deadlineLabel.startsWith("До ")).toBe(true);
  });

  it("marks a draft and an overdue assignment without calling them ready for review", () => {
    const draft = mapUnsubmittedWork({
      id: "hw-1-student-2",
      homework_id: 1,
      student_id: 2,
      student_name: "Оля",
      title: "Черновик",
      issued_at: "2026-10-01T10:00:00+03:00",
      due_at: "2026-10-02T10:00:00+03:00",
      status: "draft",
      is_overdue: true,
    });
    expect(draft.metaLine).toContain("Черновик");
    expect(draft.metaLine).toContain("Просрочено");
    expect(draft.deadlineTone).toBe("overdue");
    expect(draft.submittedForReview).toBe(false);
  });
});

describe("reviewQueues", () => {
  it("does not mix unsubmitted, review and returned work", () => {
    const review = [
      { id: "1", filter: ["all", "new", "inbox"] },
      { id: "2", filter: ["all", "returned"] },
      { id: "3", filter: ["all", "new", "inbox", "overdue"] },
    ];
    const missing = [
      { id: "hw-8-student-3", filter: ["missing"], overdue: true },
      { id: "hw-8-student-4", filter: ["missing"], overdue: false },
    ];
    const queues = reviewQueues(review, missing);
    expect(queues.toReview.map((item) => item.id)).toEqual(["1", "3"]);
    expect(queues.notSubmitted.map((item) => item.id)).toEqual(["hw-8-student-3", "hw-8-student-4"]);
    expect(queues.returned.map((item) => item.id)).toEqual(["2"]);
    expect(queues.checked.map((item) => item.id)).toEqual([]);
    expect(queues.overdue.map((item) => item.id)).toEqual(["3", "hw-8-student-3"]);
    expect(queues.toReview.some((item) => item.filter.includes("missing"))).toBe(false);
    expect(queues.returned.some((item) => item.filter.includes("done"))).toBe(false);
  });
});

describe("classifyReviewItem", () => {
  const submittedAt = "2026-10-02T12:00:00+03:00";

  it("keeps a returned work with submitted_at out of review and checked tabs", () => {
    const returned = classifyReviewItem({
      status: "returned",
      homework_submission: { submitted_at: submittedAt },
    });
    const pending = classifyReviewItem({
      status: "pending",
      homework_submission: { submitted_at: submittedAt },
    });
    const checked = classifyReviewItem({
      status: "checked",
      homework_submission: { submitted_at: submittedAt },
    });
    const resubmitted = classifyReviewItem({
      status: "pending",
      homework_submission: { submitted_at: "2026-10-03T09:00:00+03:00" },
    });

    expect(returned.filter).toEqual(["all", "returned"]);
    expect(returned.filter).not.toContain("done");
    expect(returned.filter).not.toContain("inbox");
    expect(pending.filter).toEqual(["all", "new", "inbox"]);
    expect(checked.filter).toEqual(["all", "done"]);
    expect(resubmitted.filter).toEqual(["all", "new", "inbox"]);
    expect(resubmitted.filter).not.toContain("returned");
  });

  it("counts each work once and does not add overdue into the other tabs", () => {
    const works = [
      { id: "p", ...classifyReviewItem({ status: "pending", homework_submission: { submitted_at: submittedAt } }, { overdue: true }) },
      { id: "r", ...classifyReviewItem({ status: "returned", homework_submission: { submitted_at: submittedAt } }) },
      { id: "c", ...classifyReviewItem({ status: "checked", homework_submission: { submitted_at: submittedAt } }) },
    ].map((item) => ({ ...item, filter: item.filter }));
    const missing = [{ id: "u", filter: ["missing"], overdue: false }];
    const counts = reviewTabCounts(works, missing);

    expect(counts.pending).toBe(1);
    expect(counts.returned).toBe(1);
    expect(counts.checked).toBe(1);
    expect(counts.unsubmitted).toBe(1);
    expect(counts.overdue).toBe(1);
    expect(counts.all).toBe(3);
    expect(counts.pending + counts.returned + counts.checked).toBe(counts.all);
    expect(counts.all).not.toBe(counts.pending + counts.returned + counts.checked + counts.overdue + counts.unsubmitted);
  });
});
