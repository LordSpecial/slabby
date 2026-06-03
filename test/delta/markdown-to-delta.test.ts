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

  test("bold emits insert with bold attribute", async () => {
    const result = await Effect.runPromise(markdownToDelta("**hi**"));
    expect(result.ops).toEqual([
      { insert: "hi", attributes: { bold: true } },
      { insert: "\n" },
    ]);
  });

  test("italic emits insert with italic attribute", async () => {
    const result = await Effect.runPromise(markdownToDelta("_hi_"));
    expect(result.ops).toEqual([
      { insert: "hi", attributes: { italic: true } },
      { insert: "\n" },
    ]);
  });

  test("strikethrough emits insert with strike attribute", async () => {
    const result = await Effect.runPromise(markdownToDelta("~~hi~~"));
    expect(result.ops).toEqual([
      { insert: "hi", attributes: { strike: true } },
      { insert: "\n" },
    ]);
  });

  test("inline code emits insert with code attribute", async () => {
    const result = await Effect.runPromise(markdownToDelta("hello `world`"));
    expect(result.ops).toEqual([
      { insert: "hello " },
      { insert: "world", attributes: { code: true } },
      { insert: "\n" },
    ]);
  });

  test("nested bold within italic combines attributes", async () => {
    const result = await Effect.runPromise(markdownToDelta("_**hi**_"));
    expect(result.ops).toEqual([
      { insert: "hi", attributes: { italic: true, bold: true } },
      { insert: "\n" },
    ]);
  });
});
