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

interface FlatOp {
  readonly opIndex: number;
  readonly text: string; // empty if embed
  readonly isEmbed: boolean;
  readonly attrs: Record<string, unknown> | undefined;
}

function flatten(delta: DeltaShape): { chars: FlatOp[]; total: number } {
  const chars: FlatOp[] = [];
  let total = 0;
  delta.ops.forEach((op, opIndex) => {
    const attrs = (op as { attributes?: Record<string, unknown> }).attributes;
    const insert = (op as { insert?: unknown }).insert;
    if (typeof insert === "string") {
      for (const ch of insert) {
        chars.push({ opIndex, text: ch, isEmbed: false, attrs });
        total += 1;
      }
    } else if (insert !== undefined) {
      chars.push({ opIndex, text: "", isEmbed: true, attrs });
      total += 1;
    }
  });
  return { chars, total };
}

function projectPlainText(flat: FlatOp[]): string {
  return flat.map((c) => (c.isEmbed ? "￼" : c.text)).join("");
}

function attrsEqual(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

export const buildFindReplaceDelta = (
  current: DeltaShape,
  oldText: string,
  newText: string,
): Effect.Effect<DeltaShape, DeltaEditError> =>
  Effect.gen(function* () {
    const { chars } = flatten(current);
    const plain = projectPlainText(chars);
    const first = plain.indexOf(oldText);
    if (first === -1) {
      return yield* Effect.fail(new DeltaEditError({
        kind: "not_found",
        message: `oldText not found`,
      }));
    }
    const second = plain.indexOf(oldText, first + 1);
    if (second !== -1) {
      let count = 1;
      for (let i = first + 1; i !== -1; ) {
        i = plain.indexOf(oldText, i + 1);
        if (i !== -1) count += 1;
      }
      return yield* Effect.fail(new DeltaEditError({
        kind: "ambiguous",
        message: `oldText matched ${count} times; add surrounding context to disambiguate`,
      }));
    }
    const spanAttrs = chars[first]!.attrs;
    for (let i = first + 1; i < first + oldText.length; i++) {
      if (!attrsEqual(chars[i]!.attrs, spanAttrs)) {
        return yield* Effect.fail(new DeltaEditError({
          kind: "mixed_attributes",
          message: "oldText spans formatting boundaries; pick text inside a single formatted run, or use replace_section / update_post for cross-format edits",
        }));
      }
    }
    const ops: DeltaOp[] = [];
    if (first > 0) ops.push({ retain: first } as unknown as DeltaOp);
    ops.push({ delete: oldText.length } as unknown as DeltaOp);
    const insertOp: DeltaOp = { insert: newText } as DeltaOp;
    if (spanAttrs && Object.keys(spanAttrs).length > 0) (insertOp as any).attributes = { ...spanAttrs };
    ops.push(insertOp);
    return { ops };
  });

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
