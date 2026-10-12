import { afterEach, describe, expect, it, vi } from "vitest";
import { SaveQueue } from "./save-queue";
afterEach(() => vi.useRealTimers());
describe("per-entity saves", () => {
  it("saves both entities after a rapid selection switch", async () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => undefined);
    const queue = new SaveQueue(send, () => {});
    queue.schedule("one", "/one", { title: "First" });
    queue.schedule("two", "/two", { title: "Second" });
    await vi.advanceTimersByTimeAsync(650);
    expect(send.mock.calls).toEqual([
      ["/one", { title: "First" }],
      ["/two", { title: "Second" }],
    ]);
    expect(queue.hasPending()).toBe(false);
  });
  it("flushes the newest draft and waits for an in-flight request", async () => {
    let release!: () => void;
    const sent: unknown[] = [];
    const queue = new SaveQueue(
      async (_url, body) => {
        sent.push(body);
        if (sent.length === 1)
          await new Promise<void>((r) => {
            release = r;
          });
      },
      () => {},
    );
    queue.schedule("one", "/one", { title: "Old" });
    const flush = queue.flush();
    queue.schedule("one", "/one", { title: "Latest" });
    const next = queue.flush();
    release();
    await Promise.all([flush, next]);
    expect(sent).toEqual([{ title: "Old" }, { title: "Latest" }]);
    queue.dispose();
  });
  it("retains failed drafts for an explicit retry and does not run concurrent saves", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const state = vi.fn();
    const queue = new SaveQueue(send, state);
    queue.schedule("one", "/one", { body: "Unsaved" });
    await expect(queue.flush()).rejects.toThrow("offline");
    expect(queue.hasPending()).toBe(true);
    expect(state).toHaveBeenLastCalledWith("error");
    await queue.flush();
    expect(queue.hasPending()).toBe(false);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
