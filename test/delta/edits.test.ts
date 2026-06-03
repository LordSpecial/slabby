import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import {
  buildFindReplaceDelta,
  buildAppendDelta,
  buildSectionReplaceDelta,
  buildFullReplaceDelta,
  DeltaEditError,
} from "../../src/delta/edits.ts";

describe("edits scaffolding", () => {
  test("DeltaEditError tag is set", () => {
    const err = new DeltaEditError({ kind: "not_found", message: "x" });
    expect(err._tag).toBe("DeltaEditError");
    expect(err.kind).toBe("not_found");
  });
});

describe("buildFindReplaceDelta", () => {
  test("replaces a single match inside a plain insert", async () => {
    const current = { ops: [{ insert: "Hello world.\n" }] };
    const patch = await Effect.runPromise(
      buildFindReplaceDelta(current, "world", "Slab"),
    );
    expect(patch.ops).toEqual([
      { retain: 6 },
      { delete: 5 },
      { insert: "Slab" },
    ]);
  });

  test("inherits the matched op's attributes onto the inserted text", async () => {
    const current = {
      ops: [
        { insert: "Hello " },
        { insert: "world", attributes: { bold: true } },
        { insert: ".\n" },
      ],
    };
    const patch = await Effect.runPromise(
      buildFindReplaceDelta(current, "world", "Slab"),
    );
    expect(patch.ops).toEqual([
      { retain: 6 },
      { delete: 5 },
      { insert: "Slab", attributes: { bold: true } },
    ]);
  });

  test("matches across two ops that share identical attributes (no error)", async () => {
    const current = {
      ops: [
        { insert: "Hello " },
        { insert: "wor" },
        { insert: "ld.\n" },
      ],
    };
    const patch = await Effect.runPromise(
      buildFindReplaceDelta(current, "world", "Slab"),
    );
    expect(patch.ops).toEqual([
      { retain: 6 },
      { delete: 5 },
      { insert: "Slab" },
    ]);
  });

  test("returns not_found when oldText is absent", async () => {
    const current = { ops: [{ insert: "Hello world.\n" }] };
    const result = await Effect.runPromise(
      buildFindReplaceDelta(current, "absent", "x").pipe(Effect.either),
    );
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.kind).toBe("not_found");
    }
  });

  test("returns ambiguous when oldText appears more than once", async () => {
    const current = { ops: [{ insert: "ab ab ab\n" }] };
    const result = await Effect.runPromise(
      buildFindReplaceDelta(current, "ab", "X").pipe(Effect.either),
    );
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.kind).toBe("ambiguous");
      expect(result.left.message).toContain("3 times");
    }
  });

  test("returns mixed_attributes when span crosses differing attribute ops", async () => {
    const current = {
      ops: [
        { insert: "Hel" },
        { insert: "lo", attributes: { bold: true } },
        { insert: " world.\n" },
      ],
    };
    const result = await Effect.runPromise(
      buildFindReplaceDelta(current, "Hello", "Hi").pipe(Effect.either),
    );
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.kind).toBe("mixed_attributes");
    }
  });
});

describe("buildAppendDelta", () => {
  test("appends with two-newline separator when doc ends with no newline", async () => {
    const current = { ops: [{ insert: "Hi." }] };
    const patch = await Effect.runPromise(buildAppendDelta(current, "Bye."));
    expect(patch.ops).toEqual([
      { retain: 3 },
      { insert: "\n\nBye." },
      { insert: "\n" },
    ]);
  });

  test("appends with one-newline separator when doc ends with one newline", async () => {
    const current = { ops: [{ insert: "Hi.\n" }] };
    const patch = await Effect.runPromise(buildAppendDelta(current, "Bye."));
    expect(patch.ops).toEqual([
      { retain: 4 },
      { insert: "\nBye." },
      { insert: "\n" },
    ]);
  });

  test("appends with no separator when doc already ends with two newlines", async () => {
    const current = { ops: [{ insert: "Hi.\n\n" }] };
    const patch = await Effect.runPromise(buildAppendDelta(current, "Bye."));
    expect(patch.ops).toEqual([
      { retain: 5 },
      { insert: "Bye." },
      { insert: "\n" },
    ]);
  });

  test("preserves >=3 trailing newlines (never trims)", async () => {
    const current = { ops: [{ insert: "Hi.\n\n\n" }] };
    const patch = await Effect.runPromise(buildAppendDelta(current, "Bye."));
    expect(patch.ops).toEqual([
      { retain: 6 },
      { insert: "Bye." },
      { insert: "\n" },
    ]);
  });
});

describe("buildSectionReplaceDelta", () => {
  test("replaces section body up to next heading of same level", async () => {
    const current = {
      ops: [
        { insert: "Intro" },
        { insert: "\n", attributes: { header: 1 } },
        { insert: "before" },
        { insert: "\n" },
        { insert: "Mid" },
        { insert: "\n", attributes: { header: 2 } },
        { insert: "stale section body" },
        { insert: "\n" },
        { insert: "Next" },
        { insert: "\n", attributes: { header: 2 } },
        { insert: "after" },
        { insert: "\n" },
      ],
    };
    const patch = await Effect.runPromise(
      buildSectionReplaceDelta(current, "Mid", "fresh body."),
    );
    expect(patch.ops).toEqual([
      { retain: 17 },
      { delete: 19 },
      { insert: "fresh body." },
      { insert: "\n" },
    ]);
  });

  test("not_found when heading text does not match any heading line", async () => {
    const current = {
      ops: [
        { insert: "Only heading" },
        { insert: "\n", attributes: { header: 1 } },
      ],
    };
    const result = await Effect.runPromise(
      buildSectionReplaceDelta(current, "Missing", "x").pipe(Effect.either),
    );
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") expect(result.left.kind).toBe("not_found");
  });

  test("ambiguous when heading text matches more than one heading line", async () => {
    const current = {
      ops: [
        { insert: "Same" },
        { insert: "\n", attributes: { header: 2 } },
        { insert: "body 1\n" },
        { insert: "Same" },
        { insert: "\n", attributes: { header: 2 } },
        { insert: "body 2\n" },
      ],
    };
    const result = await Effect.runPromise(
      buildSectionReplaceDelta(current, "Same", "x").pipe(Effect.either),
    );
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") expect(result.left.kind).toBe("ambiguous");
  });

  test("section ends at end-of-doc when no next same-or-higher heading exists", async () => {
    const current = {
      ops: [
        { insert: "Top" },
        { insert: "\n", attributes: { header: 1 } },
        { insert: "Mid" },
        { insert: "\n", attributes: { header: 2 } },
        { insert: "old body\n" },
      ],
    };
    const patch = await Effect.runPromise(
      buildSectionReplaceDelta(current, "Mid", "new body."),
    );
    expect(patch.ops).toEqual([
      { retain: 8 },
      { delete: 9 },
      { insert: "new body." },
      { insert: "\n" },
    ]);
  });
});
