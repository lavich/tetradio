import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { kvAdapter } from "../src/sync/adapter";
import { encodeSnapshot, packSnapshot, unpackSnapshot } from "../src/sync/codec";
import { memoryTransport } from "../src/sync/transport";
import fixture from "./fixtures/sync-format6.json";
import { SNAPSHOT_FORMAT, type CompactSnapshot } from "../src/sync/types";

const greek: CompactSnapshot = {
  format: SNAPSHOT_FORMAT,
  createdAt: "2026-10-19T10:00:00.000Z",
  lessons: [{ id: "μάθημα-1", completed: true, updatedAt: "2026-10-18T10:00:00.000Z" }],
  packages: ["mech-1"],
  blocks: [],
  states: Array.from({ length: 400 }, (_, index) => ({
    ref: { code: "ψ", id: `καλημέρα-${index}` },
    card: {
      due: "2026-10-20T00:00:00.000Z",
      stability: 1 + index / 7,
      difficulty: 5 + index / 13,
      elapsed_days: 1,
      scheduled_days: 2,
      reps: index % 9,
      lapses: 0,
      state: 2,
      learning_steps: 0,
    },
    introducedAt: "2026-10-01T00:00:00.000Z",
    version: 1,
  })),
  skills: [],
  stats: { days: [], recentByType: {}, answers: 0, answeredKeys: [] },
};

describe("упаковка снимка формата 6", () => {
  const json = encodeSnapshot(greek);

  it("круг упаковки снимка с греческим id незнакомого вида возвращает тот же JSON", () => {
    expect([...json].some((char) => char.charCodeAt(0) > 0x7f)).toBe(true);
    expect(unpackSnapshot(packSnapshot(json))).toBe(json);
  });
  it("упакованный текст — только base64 ASCII и короче JSON", () => {
    const packed = packSnapshot(json);
    expect(packed).toMatch(/^[A-Za-z0-9+/=]*$/);
    expect(packed.length).toBeLessThan(json.length);
  });
  it("поток — стандартный raw deflate: zlib в Node распаковывает его в тот же JSON", () => {
    expect(inflateRawSync(Buffer.from(packSnapshot(json), "base64")).toString("utf8")).toBe(json);
  });
  it("большой снимок упаковывается без переполнения стека", () => {
    const big = JSON.stringify({ f: 6, pad: Array.from({ length: 200_000 }, (_, index) => index * 7919) });
    expect(unpackSnapshot(packSnapshot(big))).toBe(big);
  });
  it("обрезанный поток бросает ошибку", () => {
    const packed = packSnapshot(json);
    const bytes = Buffer.from(packed, "base64");
    const truncated = bytes.subarray(0, Math.floor(bytes.length / 2)).toString("base64");
    expect(() => unpackSnapshot(truncated)).toThrow();
  });
});

it("облако после настоящей публикации формата 6 читается в ожидаемый снимок", async () => {
  const cloud = memoryTransport();
  for (const [key, value] of Object.entries(fixture.cloud)) cloud.store.set(key, value);
  const adapter = kvAdapter(cloud);
  const [pointer] = (await adapter.listPointers()).pointers;
  expect(pointer).toMatchObject({ format: 6, reads: [3, 4, 5, 6], content: expect.any(String) });
  expect(await adapter.readVersion(pointer)).toEqual(fixture.snapshot);
});
