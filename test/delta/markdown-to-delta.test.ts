import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { markdownToDelta } from "../../src/delta/markdown-to-delta.ts";

describe("markdownToDelta", () => {
  test("empty string returns empty ops", async () => {
    const result = await Effect.runPromise(markdownToDelta(""));
    expect(result.ops).toEqual([]);
  });
});
