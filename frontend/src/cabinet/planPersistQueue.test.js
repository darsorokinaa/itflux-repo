import { describe, expect, it } from "vitest";
import { createPersistQueue } from "./planPersistQueue";

describe("createPersistQueue", () => {
  it("runs a second save only after the first has finished", async () => {
    const enqueue = createPersistQueue();
    const order = [];
    let releaseFirst;
    const first = enqueue(() => new Promise((resolve) => {
      order.push("start-1");
      releaseFirst = () => {
        order.push("end-1");
        resolve("first");
      };
    }));
    await Promise.resolve();
    const second = enqueue(async () => {
      order.push("start-2");
      return "second";
    });

    expect(order).toEqual(["start-1"]);
    releaseFirst();
    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
    expect(order).toEqual(["start-1", "end-1", "start-2"]);
  });

  it("continues the queue after a failed save", async () => {
    const enqueue = createPersistQueue();
    const order = [];
    await expect(enqueue(async () => {
      order.push("fail");
      throw new Error("save failed");
    })).rejects.toThrow("save failed");
    await enqueue(async () => {
      order.push("next");
    });
    expect(order).toEqual(["fail", "next"]);
  });
});
