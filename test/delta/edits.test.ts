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
});
