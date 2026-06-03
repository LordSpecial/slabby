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
