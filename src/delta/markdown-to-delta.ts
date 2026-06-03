/**
 * Markdown → Quill Delta (`{ops: [...]}`).
 *
 * Used by the editing engine to convert agent-supplied markdown into the
 * Delta format the Slab GraphQL `updatePostContent` mutation accepts.
 *
 * Lossy edges (locked-in for v1, see spec §4 Layer A):
 *   - Tables: not emitted; raw text dropped.
 *   - Footnotes: not emitted; raw text dropped.
 *   - Raw HTML: not parsed; pass-through as plain text.
 */

import { Effect, Data } from "effect";

export class MarkdownParseError extends Data.TaggedError("MarkdownParseError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface DeltaOp {
  insert: string | Record<string, unknown>;
  attributes?: Record<string, unknown>;
}

export interface Delta {
  ops: DeltaOp[];
}

export const markdownToDelta = (markdown: string): Effect.Effect<Delta, MarkdownParseError> => {
  return Effect.succeed({ ops: [] }); // placeholder, filled in by subsequent steps
};
