import { afterEach, describe, expect, it, vi } from "vitest";

const form = vi.hoisted(() => ({ available: true }));
vi.mock("../src/platform/feedback", async (original) => ({
  ...(await original<typeof import("../src/platform/feedback")>()),
  formAvailable: () => form.available,
}));
const sent = vi.hoisted(() => [] as unknown[][]);
vi.mock("../src/platform/feedback-send", async (original) => ({
  ...(await original<typeof import("../src/platform/feedback-send")>()),
  waitlist: async (...args: unknown[]) => {
    sent.push(args);
    return { result: "ok" };
  },
}));

const { eraseDeps } = await import("../src/app/erase-deps");

afterEach(() => {
  sent.length = 0;
  form.available = true;
});

describe("удаление заявок при «Удалить мои данные»", () => {
  it("с формой — удаление заявок через /waitlist с forget", async () => {
    const deps = eraseDeps();
    expect(await deps.leaveWaitlist?.()).toBe("ok");
    expect(sent).toEqual([["forget", null]]);
  });

  it("без формы — шага нет", () => {
    form.available = false;
    expect("leaveWaitlist" in eraseDeps()).toBe(false);
  });
});
