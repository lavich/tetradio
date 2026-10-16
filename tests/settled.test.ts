import { expect, it } from "vitest";
import { settledFor } from "../src/features/course/settled";

it("итог другого урока не принимается за итог этого", () => {
  const previous = { lessonId: "m01-1", step: null, reading: null };
  expect(settledFor(previous, "m01-test")).toBeUndefined();
  expect(settledFor(previous, "m01-1")).toBe(previous);
  expect(settledFor(undefined, "m01-1")).toBeUndefined();
});
