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
    if (first > 0) ops.push({ retain: first });
    ops.push({ delete: oldText.length });
    const insertOp: DeltaOp = spanAttrs && Object.keys(spanAttrs).length > 0
      ? { insert: newText, attributes: { ...spanAttrs } }
      : { insert: newText };
    ops.push(insertOp);
    return { ops };
  });

export const buildAppendDelta = (
  current: DeltaShape,
  newMarkdown: string,
): Effect.Effect<DeltaShape, DeltaEditError> =>
  Effect.gen(function* () {
    const { chars, total } = flatten(current);
    const newDelta = yield* markdownToDelta(newMarkdown).pipe(
      Effect.mapError((e) => new DeltaEditError({
        kind: "parse_failure",
        message: `failed to parse appended markdown: ${e.message}`,
      })),
    );
    let tailNewlines = 0;
    for (let i = chars.length - 1; i >= 0; i--) {
      const c = chars[i]!;
      if (!c.isEmbed && c.text === "\n") tailNewlines += 1;
      else break;
    }
    const sepCount = Math.max(0, 2 - tailNewlines);
    const sep = "\n".repeat(sepCount);
    const ops: DeltaOp[] = [];
    if (total > 0) ops.push({ retain: total });
    const newOps = newDelta.ops;
    if (sep.length > 0) {
      const firstOp = newOps[0];
      if (
        firstOp &&
        "insert" in firstOp &&
        typeof firstOp.insert === "string" &&
        firstOp.attributes === undefined
      ) {
        ops.push({ insert: sep + firstOp.insert });
        for (let i = 1; i < newOps.length; i++) ops.push(newOps[i]!);
      } else {
        ops.push({ insert: sep });
        for (const op of newOps) ops.push(op);
      }
    } else {
      for (const op of newOps) ops.push(op);
    }
    return { ops };
  });

interface LineRecord {
  startIndex: number;
  endIndex: number;
  newlineIndex: number;
  blockAttrs: Record<string, unknown> | undefined;
  plainText: string;
}

function collectLines(chars: FlatOp[]): LineRecord[] {
  const lines: LineRecord[] = [];
  let cursor = 0;
  let buf: string[] = [];
  let lineStart = 0;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!;
    if (!c.isEmbed && c.text === "\n") {
      lines.push({
        startIndex: lineStart,
        endIndex: cursor,
        newlineIndex: cursor,
        blockAttrs: c.attrs,
        plainText: buf.join("").trim(),
      });
      buf = [];
      cursor += 1;
      lineStart = cursor;
    } else {
      buf.push(c.isEmbed ? "￼" : c.text);
      cursor += 1;
    }
  }
  if (buf.length > 0) {
    lines.push({
      startIndex: lineStart,
      endIndex: cursor,
      newlineIndex: -1,
      blockAttrs: undefined,
      plainText: buf.join("").trim(),
    });
  }
  return lines;
}

function headerLevel(attrs: Record<string, unknown> | undefined): number | null {
  if (!attrs) return null;
  const h = attrs["header"];
  if (typeof h === "number" && h >= 1 && h <= 6) return h;
  return null;
}

export const buildSectionReplaceDelta = (
  current: DeltaShape,
  heading: string,
  newSectionMarkdown: string,
): Effect.Effect<DeltaShape, DeltaEditError> =>
  Effect.gen(function* () {
    const { chars, total } = flatten(current);
    const lines = collectLines(chars);
    const matches: { lineIdx: number; level: number }[] = [];
    lines.forEach((ln, idx) => {
      const lvl = headerLevel(ln.blockAttrs);
      if (lvl !== null && ln.plainText === heading) matches.push({ lineIdx: idx, level: lvl });
    });
    if (matches.length === 0) {
      return yield* Effect.fail(new DeltaEditError({
        kind: "not_found",
        message: `heading '${heading}' not found`,
      }));
    }
    if (matches.length > 1) {
      return yield* Effect.fail(new DeltaEditError({
        kind: "ambiguous",
        message: `heading '${heading}' matched ${matches.length} times; section replace requires a unique heading`,
      }));
    }
    const { lineIdx, level } = matches[0]!;
    const headingLine = lines[lineIdx]!;
    const spanStart = headingLine.newlineIndex + 1;
    let spanEnd = total;
    for (let i = lineIdx + 1; i < lines.length; i++) {
      const lvl = headerLevel(lines[i]!.blockAttrs);
      if (lvl !== null && lvl <= level) {
        spanEnd = lines[i]!.startIndex;
        break;
      }
    }
    const newDelta = yield* markdownToDelta(newSectionMarkdown).pipe(
      Effect.mapError((e) => new DeltaEditError({
        kind: "parse_failure",
        message: `failed to parse section markdown: ${e.message}`,
      })),
    );
    const ops: DeltaOp[] = [];
    if (spanStart > 0) ops.push({ retain: spanStart });
    const deleteLen = spanEnd - spanStart;
    if (deleteLen > 0) ops.push({ delete: deleteLen });
    for (const op of newDelta.ops) ops.push(op);
    return { ops };
  });

export const buildFullReplaceDelta = (
  current: DeltaShape,
  newMarkdown: string,
): Effect.Effect<DeltaShape, DeltaEditError> =>
  Effect.gen(function* () {
    const newDelta = yield* markdownToDelta(newMarkdown).pipe(
      Effect.mapError((e) => new DeltaEditError({
        kind: "parse_failure",
        message: `failed to parse new markdown: ${e.message}`,
      })),
    );
    const a = new Delta(current.ops);
    const b = new Delta(newDelta.ops);
    const diff = a.diff(b);
    return { ops: diff.ops as DeltaOp[] };
  });
