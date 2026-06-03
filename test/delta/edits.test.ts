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
