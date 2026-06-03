import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { markdownToDelta } from "../../src/delta/markdown-to-delta.ts";

describe("markdownToDelta", () => {
  test("empty string returns empty ops", async () => {
    const result = await Effect.runPromise(markdownToDelta(""));
    expect(result.ops).toEqual([]);
  });

  test("single paragraph emits insert + trailing newline", async () => {
    const result = await Effect.runPromise(markdownToDelta("Hello world."));
    expect(result.ops).toEqual([
      { insert: "Hello world." },
      { insert: "\n" },
    ]);
  });

  test("two paragraphs separated by blank line emit two newline-terminated inserts", async () => {
    const result = await Effect.runPromise(markdownToDelta("First.\n\nSecond."));
    expect(result.ops).toEqual([
      { insert: "First." },
      { insert: "\n" },
      { insert: "Second." },
      { insert: "\n" },
    ]);
  });
});
