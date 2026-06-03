/**
 * Pure edit-Delta builders. Each function takes the current post Delta and
 * returns a Quill Delta patch (retain/delete/insert ops) suitable for the
 * Slab `updatePostContent` mutation. No I/O.
 *
 * See spec §4 Layer B for semantics.
 */

import { Data } from "effect";
import Delta from "quill-delta";
import type { Delta as DeltaShape, DeltaOp } from "./markdown-to-delta.ts";
import { markdownToDelta } from "./markdown-to-delta.ts";
import { Effect } from "effect";

export class DeltaEditError extends Data.TaggedError("DeltaEditError")<{
  readonly message: string;
  readonly kind:
    | "not_found"
    | "ambiguous"
    | "mixed_attributes"
    | "parse_failure";
}> {}

export const buildFindReplaceDelta = (
  current: DeltaShape,
  oldText: string,
  newText: string,
): Effect.Effect<DeltaShape, DeltaEditError> =>
  Effect.fail(new DeltaEditError({ kind: "not_found", message: "stub" }));

export const buildAppendDelta = (
  current: DeltaShape,
  newMarkdown: string,
): Effect.Effect<DeltaShape, DeltaEditError> =>
  Effect.fail(new DeltaEditError({ kind: "not_found", message: "stub" }));

export const buildSectionReplaceDelta = (
  current: DeltaShape,
  heading: string,
  newSectionMarkdown: string,
): Effect.Effect<DeltaShape, DeltaEditError> =>
  Effect.fail(new DeltaEditError({ kind: "not_found", message: "stub" }));

export const buildFullReplaceDelta = (
  current: DeltaShape,
  newMarkdown: string,
): Effect.Effect<DeltaShape, DeltaEditError> =>
  Effect.fail(new DeltaEditError({ kind: "not_found", message: "stub" }));
