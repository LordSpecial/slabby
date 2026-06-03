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
import { marked } from "marked";
import type { Token, Tokens } from "marked";

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

export const markdownToDelta = (markdown: string): Effect.Effect<Delta, MarkdownParseError> =>
  Effect.try({
    try: () => {
      const tokens = marked.lexer(markdown);
      const ops: DeltaOp[] = [];
      for (const token of tokens) {
        emitToken(token, ops, {});
      }
      return { ops };
    },
    catch: (error) => new MarkdownParseError({ message: `marked lex failed: ${error}`, cause: error }),
  });

interface InlineAttrs {
  bold?: true;
  italic?: true;
  strike?: true;
  code?: true;
  link?: string;
}

interface ListContext {
  kind: "ordered" | "bullet";
  indent: number;
}

function emitToken(token: Token, ops: DeltaOp[], parentAttrs: InlineAttrs, listCtx?: ListContext): void {
  switch (token.type) {
    case "paragraph": {
      const p = token as Tokens.Paragraph;
      for (const child of p.tokens ?? []) emitInline(child, ops, parentAttrs);
      if (listCtx) {
        const attrs: Record<string, unknown> = { list: listCtx.kind };
        if (listCtx.indent > 0) attrs.indent = listCtx.indent;
        ops.push({ insert: "\n", attributes: attrs });
      } else {
        ops.push({ insert: "\n" });
      }
      return;
    }
    case "space":
      return;
    case "text": {
      const t = token as Tokens.Text;
      if (t.tokens && t.tokens.length > 0) {
        for (const child of t.tokens) emitInline(child, ops, parentAttrs);
      } else {
        pushText(ops, t.text, parentAttrs);
      }
      if (listCtx) {
        const attrs: Record<string, unknown> = { list: listCtx.kind };
        if (listCtx.indent > 0) attrs.indent = listCtx.indent;
        ops.push({ insert: "\n", attributes: attrs });
      }
      return;
    }
    case "heading": {
      const h = token as Tokens.Heading;
      for (const child of h.tokens ?? []) emitInline(child, ops, parentAttrs);
      ops.push({ insert: "\n", attributes: { header: h.depth } });
      return;
    }
    case "code": {
      const c = token as Tokens.Code;
      const lang = (c.lang && c.lang.trim().length > 0) ? c.lang.trim() : "plain";
      const lines = c.text.split("\n");
      for (const line of lines) {
        if (line.length > 0) ops.push({ insert: line });
        ops.push({ insert: "\n", attributes: { "code-block": lang } });
      }
      return;
    }
    case "blockquote": {
      const bq = token as Tokens.Blockquote;
      const startIdx = ops.length;
      for (const child of bq.tokens ?? []) emitToken(child, ops, parentAttrs);
      for (let i = startIdx; i < ops.length; i++) {
        const op = ops[i];
        if (op && op.insert === "\n") {
          op.attributes = { ...(op.attributes ?? {}), blockquote: true };
        }
      }
      return;
    }
    case "list": {
      const list = token as Tokens.List;
      const kind: "ordered" | "bullet" = list.ordered ? "ordered" : "bullet";
      const indent = (listCtx?.indent ?? -1) + 1;
      for (const item of list.items) {
        emitToken(item, ops, parentAttrs, { kind, indent });
      }
      return;
    }
    case "list_item": {
      const item = token as Tokens.ListItem;
      for (const child of item.tokens ?? []) emitToken(child, ops, parentAttrs, listCtx);
      return;
    }
    case "html": {
      const h = token as Tokens.HTML;
      pushText(ops, h.text, parentAttrs);
      ops.push({ insert: "\n" });
      return;
    }
    case "table": {
      return;
    }
    default:
      return;
  }
}

function emitInline(token: Token, ops: DeltaOp[], parentAttrs: InlineAttrs): void {
  switch (token.type) {
    case "text": {
      const t = token as Tokens.Text;
      pushText(ops, t.text, parentAttrs);
      return;
    }
    case "strong": {
      const s = token as Tokens.Strong;
      for (const child of s.tokens ?? []) emitInline(child, ops, { ...parentAttrs, bold: true });
      return;
    }
    case "em": {
      const e = token as Tokens.Em;
      for (const child of e.tokens ?? []) emitInline(child, ops, { ...parentAttrs, italic: true });
      return;
    }
    case "del": {
      const d = token as Tokens.Del;
      for (const child of d.tokens ?? []) emitInline(child, ops, { ...parentAttrs, strike: true });
      return;
    }
    case "codespan": {
      const c = token as Tokens.Codespan;
      pushText(ops, c.text, { ...parentAttrs, code: true });
      return;
    }
    case "link": {
      const l = token as Tokens.Link;
      for (const child of l.tokens ?? []) emitInline(child, ops, { ...parentAttrs, link: l.href });
      return;
    }
    case "image": {
      const i = token as Tokens.Image;
      ops.push({ insert: { image: i.href } });
      return;
    }
    case "br": {
      ops.push({ insert: "\n" });
      return;
    }
    default:
      return;
  }
}

function pushText(ops: DeltaOp[], text: string, attrs: InlineAttrs): void {
  if (text.length === 0) return;
  const op: DeltaOp = { insert: text };
  if (hasAttrs(attrs)) op.attributes = attrsToObject(attrs);
  ops.push(op);
}

function hasAttrs(attrs: InlineAttrs): boolean {
  return Boolean(attrs.bold || attrs.italic || attrs.strike || attrs.code || attrs.link);
}

function attrsToObject(attrs: InlineAttrs): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (attrs.bold) out.bold = true;
  if (attrs.italic) out.italic = true;
  if (attrs.strike) out.strike = true;
  if (attrs.code) out.code = true;
  if (attrs.link) out.link = attrs.link;
  return out;
}
