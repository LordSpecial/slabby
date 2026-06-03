import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { markdownToDelta } from "../../src/delta/markdown-to-delta.ts";
import { contentToMarkdown } from "../../src/delta/delta-to-markdown.ts";

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

  test("link emits insert with link attribute on the visible text", async () => {
    const result = await Effect.runPromise(markdownToDelta("[Slab](https://slab.com)"));
    expect(result.ops).toEqual([
      { insert: "Slab", attributes: { link: "https://slab.com" } },
      { insert: "\n" },
    ]);
  });

  test("image emits embed insert with image attribute", async () => {
    const result = await Effect.runPromise(markdownToDelta("![alt](https://example.com/x.png)"));
    expect(result.ops).toEqual([
      { insert: { image: "https://example.com/x.png" } },
      { insert: "\n" },
    ]);
  });

  test("bold link combines bold + link attributes", async () => {
    const result = await Effect.runPromise(markdownToDelta("**[Slab](https://slab.com)**"));
    expect(result.ops).toEqual([
      { insert: "Slab", attributes: { bold: true, link: "https://slab.com" } },
      { insert: "\n" },
    ]);
  });

  test("h1 emits content then newline with header=1", async () => {
    const result = await Effect.runPromise(markdownToDelta("# Title"));
    expect(result.ops).toEqual([
      { insert: "Title" },
      { insert: "\n", attributes: { header: 1 } },
    ]);
  });

  test("h3 with inline bold preserves bold and emits header=3", async () => {
    const result = await Effect.runPromise(markdownToDelta("### **Bold**"));
    expect(result.ops).toEqual([
      { insert: "Bold", attributes: { bold: true } },
      { insert: "\n", attributes: { header: 3 } },
    ]);
  });

  test("fenced code block with language emits inserts then newline with code-block=lang", async () => {
    const md = "```ts\nconst x = 1;\n```";
    const result = await Effect.runPromise(markdownToDelta(md));
    expect(result.ops).toEqual([
      { insert: "const x = 1;" },
      { insert: "\n", attributes: { "code-block": "ts" } },
    ]);
  });

  test("fenced code block without language uses 'plain'", async () => {
    const md = "```\nhello\n```";
    const result = await Effect.runPromise(markdownToDelta(md));
    expect(result.ops).toEqual([
      { insert: "hello" },
      { insert: "\n", attributes: { "code-block": "plain" } },
    ]);
  });

  test("multi-line fenced code block puts each line on its own code-block newline", async () => {
    const md = "```ts\na\nb\n```";
    const result = await Effect.runPromise(markdownToDelta(md));
    expect(result.ops).toEqual([
      { insert: "a" },
      { insert: "\n", attributes: { "code-block": "ts" } },
      { insert: "b" },
      { insert: "\n", attributes: { "code-block": "ts" } },
    ]);
  });

  test("blockquote wraps each paragraph line with blockquote attribute", async () => {
    const result = await Effect.runPromise(markdownToDelta("> quoted"));
    expect(result.ops).toEqual([
      { insert: "quoted" },
      { insert: "\n", attributes: { blockquote: true } },
    ]);
  });

  test("unordered list emits bullet items", async () => {
    const md = "- a\n- b";
    const result = await Effect.runPromise(markdownToDelta(md));
    expect(result.ops).toEqual([
      { insert: "a" },
      { insert: "\n", attributes: { list: "bullet" } },
      { insert: "b" },
      { insert: "\n", attributes: { list: "bullet" } },
    ]);
  });

  test("ordered list emits ordered items", async () => {
    const md = "1. a\n2. b";
    const result = await Effect.runPromise(markdownToDelta(md));
    expect(result.ops).toEqual([
      { insert: "a" },
      { insert: "\n", attributes: { list: "ordered" } },
      { insert: "b" },
      { insert: "\n", attributes: { list: "ordered" } },
    ]);
  });

  test("nested list emits indent attribute on inner items", async () => {
    const md = "- outer\n  - inner";
    const result = await Effect.runPromise(markdownToDelta(md));
    expect(result.ops).toEqual([
      { insert: "outer" },
      { insert: "\n", attributes: { list: "bullet" } },
      { insert: "inner" },
      { insert: "\n", attributes: { list: "bullet", indent: 1 } },
    ]);
  });

  test("hard break emits a single newline insert", async () => {
    const result = await Effect.runPromise(markdownToDelta("a  \nb"));
    expect(result.ops).toEqual([
      { insert: "a" },
      { insert: "\n" },
      { insert: "b" },
      { insert: "\n" },
    ]);
  });

  test("table is silently dropped (known-lossy v1)", async () => {
    const md = "| a | b |\n|---|---|\n| 1 | 2 |";
    const result = await Effect.runPromise(markdownToDelta(md));
    expect(result.ops).toEqual([]);
  });

  test("raw HTML is passed through as plain text (known-lossy v1)", async () => {
    const result = await Effect.runPromise(markdownToDelta("<div>x</div>"));
    expect(result.ops).toEqual([
      { insert: "<div>x</div>" },
      { insert: "\n" },
    ]);
  });

  test("round-trip: simple doc with heading, paragraph, list", async () => {
    const md = "# Title\n\nIntro paragraph.\n\n- a\n- b";
    const delta = await Effect.runPromise(markdownToDelta(md));
    const back = await Effect.runPromise(contentToMarkdown(delta));
    expect(back.trim()).toBe("# Title\n\nIntro paragraph.\n\n-   a\n-   b");
  });
});
