# Slabby Editing Engine + Expanded Mutation Coverage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace slabby's destructive whole-document `update_post` with a real Quill Delta editing engine (find-and-replace, append, section replace, Delta-diffed full update) and add expanded Slab GraphQL mutation coverage — every post and topic mutation except `deletePost`.

**Architecture:** Three new layers under `src/delta/` (markdown→Delta, Delta→markdown, pure edit-Delta builders). `src/client.ts` is reduced to GraphQL transport; `src/posts.ts` and `src/topics.ts` become Effect services consuming `SlabClientService`. MCP tool definitions split into `src/tools/{posts,topics,search}.ts`. New Effect service layers compose through a single `SlabClientLayer` defined once.

**Tech Stack:** Bun runtime + `bun test`. Effect (already used). `quill-delta` (new dep) for Delta class + `.diff()` + `.compose()`. `marked` (new dep) for markdown→Delta lexing. `quill-delta-to-html` + `turndown` (already used) for Delta→markdown.

**Spec:** [`docs/superpowers/specs/2026-06-03-slabby-editing-and-mutations-design.md`](../specs/2026-06-03-slabby-editing-and-mutations-design.md). Read this before starting any task — every task references it by section.

**Branch:** Already on `feat/editing-engine`, pushed to `origin` (`LordSpecial/slabby`). All commits in this plan land here.

---

## Conventions used in this plan

- All commands assume the repo root (`/Users/simon/dev/slabby`).
- `bun test <path>` is the test runner; `bun test` runs everything.
- Commit message format: Conventional Commits (existing repo uses `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`).
- After every code change: run `bun test` to confirm nothing else broke, then commit. If anything previously-passing now fails, stop and fix before continuing.
- Type-only constants in tests (mocked GraphQL responses) live next to their tests, not in shared fixtures, to keep tests independently readable.
- Tagged errors follow the existing `Data.TaggedError("<Name>")<{...}>` pattern from `src/client.ts:35-44`.

---

## Task 1: Add dependencies and relocate `deltaToMarkdown.ts`

**Files:**
- Modify: `package.json` (add `quill-delta`, `marked` to `dependencies`)
- Create: `src/delta/` (new directory)
- Move: `src/deltaToMarkdown.ts` → `src/delta/delta-to-markdown.ts`
- Move: `test/deltaToMarkdown.test.ts` → `test/delta/delta-to-markdown.test.ts`
- Modify: `src/client.ts` (update import path)
- Modify: `test/delta/delta-to-markdown.test.ts` (update import path)

- [ ] **Step 1.1: Install new dependencies**

Run:

```bash
bun add quill-delta@^5 marked@^14
```

Expected: `package.json` gets two new entries under `dependencies`; `bun.lock` updates.

- [ ] **Step 1.2: Verify deps installed**

Run:

```bash
bun pm ls 2>&1 | grep -E '(quill-delta|marked)'
```

Expected: lines mentioning `quill-delta@5.*.*` and `marked@14.*.*`.

- [ ] **Step 1.3: Create the `src/delta/` directory and move the existing converter**

Run:

```bash
mkdir -p src/delta test/delta
git mv src/deltaToMarkdown.ts src/delta/delta-to-markdown.ts
git mv test/deltaToMarkdown.test.ts test/delta/delta-to-markdown.test.ts
```

Expected: both files in their new locations; `git status` shows two renames.

- [ ] **Step 1.4: Update the import in `src/client.ts`**

In `src/client.ts`, change:

```ts
import { contentToMarkdown, DeltaConversionError } from "./deltaToMarkdown.ts";
```

to:

```ts
import { contentToMarkdown, DeltaConversionError } from "./delta/delta-to-markdown.ts";
```

- [ ] **Step 1.5: Update the import in `test/delta/delta-to-markdown.test.ts`**

The relative path now needs one more `..`. Open the file, find the import for the production module, and change `"../src/deltaToMarkdown.ts"` to `"../../src/delta/delta-to-markdown.ts"`.

- [ ] **Step 1.6: Run tests; confirm everything still passes**

Run:

```bash
bun test
```

Expected: all existing tests pass. No new failures from the relocation.

- [ ] **Step 1.7: Commit**

```bash
git add package.json bun.lock src/client.ts src/delta/delta-to-markdown.ts test/delta/delta-to-markdown.test.ts
git rm src/deltaToMarkdown.ts test/deltaToMarkdown.test.ts 2>/dev/null || true
git commit -m "chore: add quill-delta + marked, relocate delta-to-markdown to src/delta/"
```

---

## Task 2: Build `markdown-to-delta.ts` (Layer A, the inverse direction)

**Spec reference:** §4 Layer A (markdown-to-delta path), §8 unit tests `markdown-to-delta.test.ts`.

**Files:**
- Create: `src/delta/markdown-to-delta.ts`
- Create: `test/delta/markdown-to-delta.test.ts`

This is the biggest single piece of new code. Build it construct-by-construct, TDD, one markdown feature per sub-task.

### 2.1: Scaffold the module and the test file

- [ ] **Step 2.1.1: Create `src/delta/markdown-to-delta.ts` with a typed stub**

```ts
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
```

- [ ] **Step 2.1.2: Create `test/delta/markdown-to-delta.test.ts` with a smoke test**

```ts
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { markdownToDelta } from "../../src/delta/markdown-to-delta.ts";

describe("markdownToDelta", () => {
  test("empty string returns empty ops", async () => {
    const result = await Effect.runPromise(markdownToDelta(""));
    expect(result.ops).toEqual([]);
  });
});
```

- [ ] **Step 2.1.3: Run the smoke test**

```bash
bun test test/delta/markdown-to-delta.test.ts
```

Expected: 1 test passes (the placeholder returns empty ops, matching the assertion).

- [ ] **Step 2.1.4: Commit the scaffold**

```bash
git add src/delta/markdown-to-delta.ts test/delta/markdown-to-delta.test.ts
git commit -m "feat(delta): scaffold markdown-to-delta module"
```

### 2.2: Plain paragraphs

- [ ] **Step 2.2.1: Add the failing test**

Append to `test/delta/markdown-to-delta.test.ts`:

```ts
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
```

- [ ] **Step 2.2.2: Run; verify failure**

```bash
bun test test/delta/markdown-to-delta.test.ts
```

Expected: both new tests fail because `markdownToDelta` returns empty ops.

- [ ] **Step 2.2.3: Implement paragraph support**

Replace the body of `markdownToDelta` in `src/delta/markdown-to-delta.ts`:

```ts
import { marked } from "marked";
import type { Token, Tokens } from "marked";

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

function emitToken(token: Token, ops: DeltaOp[], parentAttrs: InlineAttrs): void {
  switch (token.type) {
    case "paragraph": {
      const p = token as Tokens.Paragraph;
      for (const child of p.tokens ?? []) emitInline(child, ops, parentAttrs);
      ops.push({ insert: "\n" });
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
      return;
    }
    default:
      // unhandled token types fall through; later sub-tasks add cases here.
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
```

- [ ] **Step 2.2.4: Run; expect both paragraph tests pass**

```bash
bun test test/delta/markdown-to-delta.test.ts
```

Expected: 3 tests pass (empty + 2 paragraph tests).

- [ ] **Step 2.2.5: Commit**

```bash
git add src/delta/markdown-to-delta.ts test/delta/markdown-to-delta.test.ts
git commit -m "feat(delta): emit paragraphs in markdown-to-delta"
```

### 2.3: Inline emphasis (bold, italic, strike, inline code)

- [ ] **Step 2.3.1: Add failing tests**

Append to `test/delta/markdown-to-delta.test.ts`:

```ts
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
```

- [ ] **Step 2.3.2: Run; verify failure**

```bash
bun test test/delta/markdown-to-delta.test.ts
```

Expected: 5 new tests fail.

- [ ] **Step 2.3.3: Extend `emitInline` to handle emphasis tokens**

In `src/delta/markdown-to-delta.ts`, replace `emitInline` with:

```ts
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
    default:
      return;
  }
}
```

- [ ] **Step 2.3.4: Run; expect all emphasis tests pass**

```bash
bun test test/delta/markdown-to-delta.test.ts
```

Expected: 8 tests pass.

- [ ] **Step 2.3.5: Commit**

```bash
git add src/delta/markdown-to-delta.ts test/delta/markdown-to-delta.test.ts
git commit -m "feat(delta): emit inline emphasis (bold/italic/strike/codespan)"
```

### 2.4: Links and images

- [ ] **Step 2.4.1: Add failing tests**

Append to `test/delta/markdown-to-delta.test.ts`:

```ts
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
```

- [ ] **Step 2.4.2: Run; verify failure**

```bash
bun test test/delta/markdown-to-delta.test.ts
```

Expected: 3 new tests fail.

- [ ] **Step 2.4.3: Add `link` and `image` cases**

Inside `emitInline`'s switch in `src/delta/markdown-to-delta.ts`, add (above `default:`):

```ts
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
```

- [ ] **Step 2.4.4: Run; expect link/image tests pass**

```bash
bun test test/delta/markdown-to-delta.test.ts
```

Expected: 11 tests pass.

- [ ] **Step 2.4.5: Commit**

```bash
git add src/delta/markdown-to-delta.ts test/delta/markdown-to-delta.test.ts
git commit -m "feat(delta): emit links and image embeds"
```

### 2.5: Headings

- [ ] **Step 2.5.1: Add failing tests**

Append:

```ts
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
```

- [ ] **Step 2.5.2: Run; verify failure**

```bash
bun test test/delta/markdown-to-delta.test.ts
```

Expected: 2 new tests fail.

- [ ] **Step 2.5.3: Add `heading` case to `emitToken`**

Inside `emitToken`'s switch in `src/delta/markdown-to-delta.ts`, add (above `default:`):

```ts
    case "heading": {
      const h = token as Tokens.Heading;
      for (const child of h.tokens ?? []) emitInline(child, ops, parentAttrs);
      ops.push({ insert: "\n", attributes: { header: h.depth } });
      return;
    }
```

- [ ] **Step 2.5.4: Run; expect heading tests pass**

```bash
bun test test/delta/markdown-to-delta.test.ts
```

Expected: 13 tests pass.

- [ ] **Step 2.5.5: Commit**

```bash
git add src/delta/markdown-to-delta.ts test/delta/markdown-to-delta.test.ts
git commit -m "feat(delta): emit headings (h1-h6)"
```

### 2.6: Fenced code blocks

- [ ] **Step 2.6.1: Add failing tests**

Append:

```ts
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
```

- [ ] **Step 2.6.2: Run; verify failure**

```bash
bun test test/delta/markdown-to-delta.test.ts
```

Expected: 3 new tests fail.

- [ ] **Step 2.6.3: Add `code` (fenced) case**

Inside `emitToken`'s switch in `src/delta/markdown-to-delta.ts`, add (above `default:`):

```ts
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
```

- [ ] **Step 2.6.4: Run; expect code-block tests pass**

```bash
bun test test/delta/markdown-to-delta.test.ts
```

Expected: 16 tests pass.

- [ ] **Step 2.6.5: Commit**

```bash
git add src/delta/markdown-to-delta.ts test/delta/markdown-to-delta.test.ts
git commit -m "feat(delta): emit fenced code blocks with language attributes"
```

### 2.7: Blockquotes

- [ ] **Step 2.7.1: Add failing test**

Append:

```ts
  test("blockquote wraps each paragraph line with blockquote attribute", async () => {
    const result = await Effect.runPromise(markdownToDelta("> quoted"));
    expect(result.ops).toEqual([
      { insert: "quoted" },
      { insert: "\n", attributes: { blockquote: true } },
    ]);
  });
```

- [ ] **Step 2.7.2: Run; verify failure**

```bash
bun test test/delta/markdown-to-delta.test.ts
```

Expected: 1 new test fails.

- [ ] **Step 2.7.3: Add `blockquote` case**

Inside `emitToken`'s switch in `src/delta/markdown-to-delta.ts`, add (above `default:`):

```ts
    case "blockquote": {
      const bq = token as Tokens.Blockquote;
      // marked nests block tokens inside the blockquote. Re-emit each child,
      // then retroactively tag the last-emitted newline with blockquote: true.
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
```

- [ ] **Step 2.7.4: Run; expect blockquote test passes**

```bash
bun test test/delta/markdown-to-delta.test.ts
```

Expected: 17 tests pass.

- [ ] **Step 2.7.5: Commit**

```bash
git add src/delta/markdown-to-delta.ts test/delta/markdown-to-delta.test.ts
git commit -m "feat(delta): emit blockquotes by tagging child newlines"
```

### 2.8: Lists (ordered, unordered, nested)

- [ ] **Step 2.8.1: Add failing tests**

Append:

```ts
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
```

- [ ] **Step 2.8.2: Run; verify failure**

```bash
bun test test/delta/markdown-to-delta.test.ts
```

Expected: 3 new tests fail.

- [ ] **Step 2.8.3: Add `list` and `list_item` handling**

Replace the existing `emitToken` signature and body to thread `listContext`:

```ts
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
    default:
      return;
  }
}
```

Also update the top-level loop:

```ts
      for (const token of tokens) {
        emitToken(token, ops, {});
      }
```

(no change in the call site — `listCtx` is optional).

- [ ] **Step 2.8.4: Run; expect list tests pass**

```bash
bun test test/delta/markdown-to-delta.test.ts
```

Expected: 20 tests pass.

- [ ] **Step 2.8.5: Commit**

```bash
git add src/delta/markdown-to-delta.ts test/delta/markdown-to-delta.test.ts
git commit -m "feat(delta): emit ordered/unordered lists with indent"
```

### 2.9: Hard breaks and known-lossy edge tests

- [ ] **Step 2.9.1: Add tests for `<br>`, tables-dropped, raw-HTML-as-text**

Append:

```ts
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
    // Known lossy: no table rendering in v1. Spec §4 Layer A.
    expect(result.ops).toEqual([]);
  });

  test("raw HTML is passed through as plain text (known-lossy v1)", async () => {
    const result = await Effect.runPromise(markdownToDelta("<div>x</div>"));
    // marked emits raw HTML as 'html' tokens; we treat them as text.
    expect(result.ops).toEqual([
      { insert: "<div>x</div>" },
      { insert: "\n" },
    ]);
  });
```

- [ ] **Step 2.9.2: Run; verify failure**

```bash
bun test test/delta/markdown-to-delta.test.ts
```

Expected: 3 new tests fail.

- [ ] **Step 2.9.3: Handle `br`, `html`, and the table-drop**

In `emitInline`, add (above `default:`):

```ts
    case "br": {
      ops.push({ insert: "\n" });
      return;
    }
```

In `emitToken`, add (above `default:`):

```ts
    case "html": {
      const h = token as Tokens.HTML;
      pushText(ops, h.text, parentAttrs);
      ops.push({ insert: "\n" });
      return;
    }
    case "table": {
      // Known-lossy v1: drop tables. Spec §4 Layer A.
      return;
    }
```

- [ ] **Step 2.9.4: Run; expect edge tests pass**

```bash
bun test test/delta/markdown-to-delta.test.ts
```

Expected: 23 tests pass.

- [ ] **Step 2.9.5: Commit**

```bash
git add src/delta/markdown-to-delta.ts test/delta/markdown-to-delta.test.ts
git commit -m "feat(delta): handle hard breaks, html passthrough, table drop"
```

### 2.10: Round-trip sanity check

- [ ] **Step 2.10.1: Add a round-trip test**

Append:

```ts
import { contentToMarkdown } from "../../src/delta/delta-to-markdown.ts";

  test("round-trip: simple doc with heading, paragraph, list", async () => {
    const md = "# Title\n\nIntro paragraph.\n\n- a\n- b";
    const delta = await Effect.runPromise(markdownToDelta(md));
    const back = await Effect.runPromise(contentToMarkdown(delta));
    expect(back.trim()).toBe("# Title\n\nIntro paragraph.\n\n-   a\n-   b");
    // Note: turndown emits "-   " (three spaces) by default after a bullet
    // because our config sets `bulletListMarker: "-"` but the indent is
    // turndown's choice. Lock current behaviour rather than fight it.
  });
```

- [ ] **Step 2.10.2: Run; verify passes (or adjust expected to actual output)**

```bash
bun test test/delta/markdown-to-delta.test.ts
```

If the test fails because the exact whitespace/bullet shape differs, run the same code in a one-off Bun REPL or `console.log` the `back` value, then update the expected string to match the actual output. The intent is to lock the current behaviour, not to assert a particular formatting choice.

- [ ] **Step 2.10.3: Commit**

```bash
git add test/delta/markdown-to-delta.test.ts
git commit -m "test(delta): add round-trip sanity test for markdown-to-delta"
```

---

## Task 3: Build pure edit-Delta builders (`src/delta/edits.ts`)

**Spec reference:** §4 Layer B (all four builders), §7 (DeltaEditError shape), §8 unit tests `edits.test.ts`.

**Files:**
- Create: `src/delta/edits.ts`
- Create: `test/delta/edits.test.ts`

### 3.1: Scaffold + `DeltaEditError`

- [ ] **Step 3.1.1: Create `src/delta/edits.ts` with types and stubs**

```ts
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

/**
 * Find-and-replace one occurrence of `oldText` with `newText`, preserving
 * the matched op's attributes on the inserted text. v1 rejects spans whose
 * characters carry differing attribute sets.
 */
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
```

- [ ] **Step 3.1.2: Create `test/delta/edits.test.ts` with smoke test**

```ts
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
```

- [ ] **Step 3.1.3: Run; expect 1 pass**

```bash
bun test test/delta/edits.test.ts
```

Expected: 1 test passes.

- [ ] **Step 3.1.4: Commit**

```bash
git add src/delta/edits.ts test/delta/edits.test.ts
git commit -m "feat(delta): scaffold edits.ts with DeltaEditError"
```

### 3.2: `buildFindReplaceDelta` — single-op happy path

- [ ] **Step 3.2.1: Add failing tests**

Append to `test/delta/edits.test.ts`:

```ts
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
```

- [ ] **Step 3.2.2: Run; verify failure**

```bash
bun test test/delta/edits.test.ts
```

Expected: 3 new tests fail.

- [ ] **Step 3.2.3: Implement the single-op / identical-attr happy path**

Replace `buildFindReplaceDelta` in `src/delta/edits.ts` with:

```ts
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
    const attrs = op.attributes;
    if (typeof op.insert === "string") {
      for (const ch of op.insert) {
        chars.push({ opIndex, text: ch, isEmbed: false, attrs });
        total += 1;
      }
    } else {
      chars.push({ opIndex, text: "", isEmbed: true, attrs });
      total += 1;
    }
  });
  return { chars, total };
}

function projectPlainText(flat: FlatOp[]): string {
  // Embeds count as a single placeholder character so indexOf positions
  // match Delta retain semantics.
  return flat.map((c) => (c.isEmbed ? "￼" : c.text)).join("");
}

function attrsEqual(a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): boolean {
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
      // Count all matches for a helpful message.
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
    // Single match. Check attribute uniformity across the matched span.
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
    const insertOp: DeltaOp = { insert: newText };
    if (spanAttrs && Object.keys(spanAttrs).length > 0) insertOp.attributes = { ...spanAttrs };
    ops.push(insertOp);
    return { ops };
  });
```

Note on the `as unknown as DeltaOp` casts: `retain` and `delete` ops are valid Delta ops but don't fit the narrow `DeltaOp` insert-only type defined in `markdown-to-delta.ts`. We don't widen the source type yet — see Step 3.7 for that cleanup.

- [ ] **Step 3.2.4: Run; expect 3 new tests pass**

```bash
bun test test/delta/edits.test.ts
```

Expected: 4 tests pass total.

- [ ] **Step 3.2.5: Commit**

```bash
git add src/delta/edits.ts test/delta/edits.test.ts
git commit -m "feat(delta): buildFindReplaceDelta single-op happy path"
```

### 3.3: `buildFindReplaceDelta` — error cases

- [ ] **Step 3.3.1: Add failing tests**

Append:

```ts
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
```

- [ ] **Step 3.3.2: Run; expect them to pass (implementation already covers all three)**

```bash
bun test test/delta/edits.test.ts
```

Expected: 7 tests pass total. (If `ambiguous` count is off-by-one in the message, fix the count loop in `buildFindReplaceDelta` before continuing.)

- [ ] **Step 3.3.3: Commit**

```bash
git add test/delta/edits.test.ts
git commit -m "test(delta): cover findReplace not_found / ambiguous / mixed_attributes"
```

### 3.4: `buildAppendDelta`

- [ ] **Step 3.4.1: Add failing tests**

Append:

```ts
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
```

- [ ] **Step 3.4.2: Run; verify failure**

```bash
bun test test/delta/edits.test.ts
```

Expected: 4 new tests fail.

- [ ] **Step 3.4.3: Implement `buildAppendDelta`**

Replace the stub in `src/delta/edits.ts`:

```ts
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
    // Count trailing newlines in the plain-text projection.
    let tailNewlines = 0;
    for (let i = chars.length - 1; i >= 0; i--) {
      const c = chars[i]!;
      if (!c.isEmbed && c.text === "\n") tailNewlines += 1;
      else break;
    }
    const sepCount = Math.max(0, 2 - tailNewlines);
    const sep = "\n".repeat(sepCount);
    const ops: DeltaOp[] = [];
    if (total > 0) ops.push({ retain: total } as unknown as DeltaOp);
    if (sep.length > 0) ops.push({ insert: sep });
    for (const op of newDelta.ops) ops.push(op);
    return { ops };
  });
```

- [ ] **Step 3.4.4: Run; expect 4 new tests pass**

```bash
bun test test/delta/edits.test.ts
```

Expected: 11 tests pass total.

- [ ] **Step 3.4.5: Commit**

```bash
git add src/delta/edits.ts test/delta/edits.test.ts
git commit -m "feat(delta): buildAppendDelta with at-least-two-newlines separator"
```

### 3.5: `buildSectionReplaceDelta`

- [ ] **Step 3.5.1: Add failing tests**

Append:

```ts
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
    // Heading "Mid\n" is preserved; everything between it and "Next" header is replaced.
    expect(patch.ops).toEqual([
      { retain: 14 },           // through "Intro\nbefore\nMid\n"
      { delete: 20 },           // "stale section body\n"
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
      { retain: 8 },             // through "Top\nMid\n"
      { delete: 9 },             // "old body\n"
      { insert: "new body." },
      { insert: "\n" },
    ]);
  });
});
```

- [ ] **Step 3.5.2: Run; verify failure**

```bash
bun test test/delta/edits.test.ts
```

Expected: 4 new tests fail.

- [ ] **Step 3.5.3: Implement `buildSectionReplaceDelta` (line-based scan)**

Replace the stub in `src/delta/edits.ts`:

```ts
interface LineRecord {
  startIndex: number;     // inclusive
  endIndex: number;       // exclusive of the trailing newline (the \n itself sits at endIndex)
  newlineIndex: number;   // position of the \n char in the flat projection
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
  // Trailing characters without a closing newline form a final line.
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
    // span start: position immediately after the heading line's newline.
    const spanStart = headingLine.newlineIndex + 1;
    // span end: position immediately before the next heading line of level <= level, or end-of-doc.
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
    if (spanStart > 0) ops.push({ retain: spanStart } as unknown as DeltaOp);
    const deleteLen = spanEnd - spanStart;
    if (deleteLen > 0) ops.push({ delete: deleteLen } as unknown as DeltaOp);
    for (const op of newDelta.ops) ops.push(op);
    return { ops };
  });
```

- [ ] **Step 3.5.4: Run; expect 4 new tests pass**

```bash
bun test test/delta/edits.test.ts
```

Expected: 15 tests pass total. If any expected ops don't match — the most likely culprit is a length-of-`\n` calculation error; print the actual ops and reconcile.

- [ ] **Step 3.5.5: Commit**

```bash
git add src/delta/edits.ts test/delta/edits.test.ts
git commit -m "feat(delta): buildSectionReplaceDelta with line-based heading scan"
```

### 3.6: `buildFullReplaceDelta` (uses `quill-delta`'s `.diff()`)

- [ ] **Step 3.6.1: Add failing tests**

Append:

```ts
describe("buildFullReplaceDelta", () => {
  test("identical content produces an empty patch", async () => {
    const md = "# Title\n\nBody.";
    const current = await Effect.runPromise(
      // import locally; we use markdownToDelta as a fixture builder.
      (await import("../../src/delta/markdown-to-delta.ts")).markdownToDelta(md),
    );
    const patch = await Effect.runPromise(buildFullReplaceDelta(current, md));
    expect(patch.ops).toEqual([]);
  });

  test("changing the body of an existing heading produces a small diff (not a full nuke)", async () => {
    const before = "# Title\n\nold body.";
    const after = "# Title\n\nnew body.";
    const current = await Effect.runPromise(
      (await import("../../src/delta/markdown-to-delta.ts")).markdownToDelta(before),
    );
    const patch = await Effect.runPromise(buildFullReplaceDelta(current, after));
    // The diff must retain the heading region and only replace the body chars.
    const ops = patch.ops as unknown as Array<Record<string, unknown>>;
    const hasFullNuke = ops.some(
      (op) => "delete" in op && typeof op.delete === "number" && op.delete > 5 && ops.length === 2,
    );
    expect(hasFullNuke).toBe(false);
    const hasRetainBeforeChange = ops.some((op) => "retain" in op);
    expect(hasRetainBeforeChange).toBe(true);
  });
});
```

- [ ] **Step 3.6.2: Run; verify failure**

```bash
bun test test/delta/edits.test.ts
```

Expected: 2 new tests fail.

- [ ] **Step 3.6.3: Implement `buildFullReplaceDelta` via `quill-delta` diff**

Replace the stub in `src/delta/edits.ts`:

```ts
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
    const a = new Delta(current.ops as any);
    const b = new Delta(newDelta.ops as any);
    const diff = a.diff(b);
    return { ops: diff.ops as unknown as DeltaOp[] };
  });
```

- [ ] **Step 3.6.4: Run; expect 2 new tests pass**

```bash
bun test test/delta/edits.test.ts
```

Expected: 17 tests pass total.

- [ ] **Step 3.6.5: Commit**

```bash
git add src/delta/edits.ts test/delta/edits.test.ts
git commit -m "feat(delta): buildFullReplaceDelta via quill-delta diff"
```

### 3.7: Widen `DeltaOp` to include retain/delete

The current `DeltaOp` type only models insert ops. Existing edit builders cast through `as unknown as DeltaOp`. Clean that up.

- [ ] **Step 3.7.1: Widen `DeltaOp` in `src/delta/markdown-to-delta.ts`**

Replace the `DeltaOp` definition with:

```ts
export type DeltaOp =
  | { insert: string | Record<string, unknown>; attributes?: Record<string, unknown> }
  | { retain: number; attributes?: Record<string, unknown> }
  | { delete: number };
```

- [ ] **Step 3.7.2: Remove the `as unknown as DeltaOp` casts in `src/delta/edits.ts`**

Find every `{ retain: ... } as unknown as DeltaOp` and `{ delete: ... } as unknown as DeltaOp` and drop the cast — the wider union now accepts them.

- [ ] **Step 3.7.3: Run all delta tests**

```bash
bun test test/delta/
```

Expected: all delta tests pass (40 tests total: 23 markdown-to-delta + 17 edits).

- [ ] **Step 3.7.4: Commit**

```bash
git add src/delta/markdown-to-delta.ts src/delta/edits.ts
git commit -m "refactor(delta): widen DeltaOp union to include retain/delete"
```

---

## Task 4: Split `client.ts` into transport + `PostsService`

**Spec reference:** §3 architecture / service composition, §4 Layer C tools (we now route them through the new service).

**Files:**
- Modify: `src/client.ts` (slim to transport only)
- Create: `src/posts.ts` (PostsService)
- Modify: `src/index.ts` (use SlabClientLayer)
- Modify: `test/client.test.ts` (rename / split tests where appropriate)
- Create: `test/posts.test.ts`

### 4.1: Move `transformPost` + `createReplacementDelta` + post operations out of `client.ts`

- [ ] **Step 4.1.1: Create `src/posts.ts` with PostsService that owns the four current operations**

Create `src/posts.ts`:

```ts
/**
 * Posts service. Wraps Slab GraphQL post-related operations on top of the
 * SlabClientService transport. Owns the Delta ↔ markdown conversion path
 * for post bodies.
 */

import { Context, Effect, Layer, Data } from "effect";
import type { SlabPost, SlabSearchResult, SlabListResult } from "./types.ts";
import { SlabClientService } from "./client.ts";
import type { SlabApiError, SlabNetworkError } from "./client.ts";
import {
  GET_POST_QUERY,
  UPDATE_POST_CONTENT_MUTATION,
  SEARCH_POSTS_QUERY,
  GET_TOPIC_POSTS_QUERY,
  GET_ORGANIZATION_POSTS_QUERY,
} from "./graphql.ts";
import { contentToMarkdown, DeltaConversionError } from "./delta/delta-to-markdown.ts";
import type { Delta as DeltaShape } from "./delta/markdown-to-delta.ts";

export type PostsError = SlabApiError | SlabNetworkError | DeltaConversionError;

export interface PostsService {
  readonly getPost: (postId: string) => Effect.Effect<SlabPost, PostsError>;
  readonly updatePostContent: (postId: string, delta: DeltaShape) => Effect.Effect<SlabPost, PostsError>;
  readonly searchPosts: (query: string) => Effect.Effect<SlabSearchResult, PostsError>;
  readonly listPosts: (topicId?: string) => Effect.Effect<SlabListResult, PostsError>;
}

export const PostsService = Context.GenericTag<PostsService>("@services/PostsService");

const transformPost = (post: any): Effect.Effect<SlabPost, DeltaConversionError> =>
  Effect.gen(function* () {
    const contentText = yield* contentToMarkdown(post.content);
    return {
      id: post.id,
      title: post.title,
      content: contentText,
      url: post.url || `https://slab.com/posts/${post.id}`,
      created_at: post.insertedAt,
      updated_at: post.updatedAt,
      created_by: post.owner
        ? { id: post.owner.id, display_name: post.owner.name, email: post.owner.email }
        : undefined,
    };
  });

export const PostsServiceLive = Layer.effect(
  PostsService,
  Effect.gen(function* () {
    const transport = yield* SlabClientService;

    return {
      getPost: (postId) =>
        Effect.gen(function* () {
          const data = yield* transport.request<{ post: any }>(GET_POST_QUERY, { id: postId });
          return yield* transformPost(data.post);
        }),

      updatePostContent: (postId, delta) =>
        Effect.gen(function* () {
          const data = yield* transport.request<{ updatePostContent: any }>(
            UPDATE_POST_CONTENT_MUTATION,
            { id: postId, delta },
          );
          return yield* transformPost(data.updatePostContent);
        }),

      searchPosts: (query) =>
        Effect.gen(function* () {
          const data = yield* transport.request<{ search: any }>(SEARCH_POSTS_QUERY, { query, first: 20 });
          const edges: any[] = data.search.edges || [];
          const posts: SlabPost[] = yield* Effect.all(
            edges.filter((e) => e.node?.post).map((e) => transformPost(e.node.post)),
          );
          return { posts, total_count: posts.length };
        }),

      listPosts: (topicId) =>
        Effect.gen(function* () {
          if (topicId) {
            const data = yield* transport.request<{ topic: any }>(GET_TOPIC_POSTS_QUERY, { topicId });
            const raw: any[] = data.topic.posts || [];
            const posts: SlabPost[] = yield* Effect.all(raw.map(transformPost));
            return { posts, total_count: posts.length };
          }
          const data = yield* transport.request<{ organization: any }>(GET_ORGANIZATION_POSTS_QUERY, {});
          const raw: any[] = data.organization.posts || [];
          const posts: SlabPost[] = yield* Effect.all(raw.map(transformPost));
          return { posts, total_count: posts.length };
        }),
    };
  }),
);
```

- [ ] **Step 4.1.2: Slim `src/client.ts` to transport only**

Replace the body of `src/client.ts` with:

```ts
import { Context, Effect, Layer, Data } from "effect";
import { ConfigService } from "./config.ts";

export class SlabApiError extends Data.TaggedError("SlabApiError")<{
  readonly message: string;
  readonly status?: number;
  readonly graphqlErrors?: any[];
}> {}

export class SlabNetworkError extends Data.TaggedError("SlabNetworkError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

interface GraphQLResponse<T = any> {
  data?: T;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: string[];
    extensions?: any;
  }>;
}

export interface SlabClientService {
  readonly request: <T>(query: string, variables?: Record<string, unknown>) =>
    Effect.Effect<T, SlabApiError | SlabNetworkError>;
}

export const SlabClientService = Context.GenericTag<SlabClientService>("@services/SlabClientService");

export const SlabClientServiceLive = Layer.effect(
  SlabClientService,
  Effect.gen(function* () {
    const { config } = yield* ConfigService;
    const { graphqlUrl, apiToken } = config;

    return {
      request: <T>(query: string, variables?: Record<string, unknown>) =>
        Effect.gen(function* () {
          const response = yield* Effect.tryPromise({
            try: () => fetch(graphqlUrl, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ query, variables }),
            }),
            catch: (error) => new SlabNetworkError({ message: `Network error: ${error}`, cause: error }),
          });

          if (!response.ok) {
            const errorText = yield* Effect.tryPromise({
              try: () => response.text(),
              catch: (error) => new SlabNetworkError({ message: `Unable to read error response: ${error}`, cause: error }),
            });
            return yield* Effect.fail(
              new SlabApiError({ message: `Slab GraphQL API error (${response.status}): ${errorText}`, status: response.status }),
            );
          }

          const json = yield* Effect.tryPromise({
            try: () => response.json() as Promise<GraphQLResponse<T>>,
            catch: (error) => new SlabNetworkError({ message: `Failed to parse JSON response: ${error}`, cause: error }),
          });

          if (json.errors && json.errors.length > 0) {
            const errorMessages = json.errors.map((e) => e.message).join(", ");
            return yield* Effect.fail(
              new SlabApiError({ message: `GraphQL errors: ${errorMessages}`, status: response.status, graphqlErrors: json.errors }),
            );
          }

          if (!json.data) {
            return yield* Effect.fail(new SlabApiError({ message: "GraphQL response missing data field", status: response.status }));
          }

          return json.data;
        }),
    };
  }),
);
```

- [ ] **Step 4.1.3: Rewire `src/index.ts` to use both services**

In `src/index.ts`:

```ts
import { Effect, Layer } from "effect";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { ConfigService, ConfigServiceLive } from "./config.ts";
import { SlabClientService, SlabClientServiceLive } from "./client.ts";
import { PostsService, PostsServiceLive } from "./posts.ts";
import { formatPostResponse, formatSearchResults, formatListResults } from "./formatters.ts";
import { extractPostId } from "./utils.ts";
import { markdownToDelta } from "./delta/markdown-to-delta.ts";
import { buildFullReplaceDelta } from "./delta/edits.ts";

const SlabClientLayer = SlabClientServiceLive.pipe(Layer.provide(ConfigServiceLive));

const AppLayer = Layer.mergeAll(
  ConfigServiceLive,
  SlabClientLayer,
  PostsServiceLive.pipe(Layer.provide(SlabClientLayer)),
);
```

The `toolHandlers` object stays the same shape but switches to `PostsService`:

```ts
const toolHandlers = {
  "slab__get_post": (args: any) =>
    Effect.gen(function* () {
      const posts = yield* PostsService;
      const postId = yield* extractPostId(args.postId as string);
      const post = yield* posts.getPost(postId);
      return formatPostResponse(post);
    }),

  "slab__update_post": (args: any) =>
    Effect.gen(function* () {
      const posts = yield* PostsService;
      const postId = yield* extractPostId(args.postId as string);
      const current = yield* posts.getPost(postId);
      // We need the raw Delta, not the markdown-projected one. Re-fetch via
      // get-then-diff: get markdown, parse to Delta, diff against the new content.
      // For Task 4 we keep the same nuke-and-paste behaviour to preserve
      // backwards compatibility; Task 5 swaps this for buildFullReplaceDelta.
      const newDelta = yield* markdownToDelta(args.content as string).pipe(
        Effect.mapError((e) => ({ ...e, message: e.message })),
      );
      const result = yield* posts.updatePostContent(postId, newDelta);
      return `Post updated successfully: ${JSON.stringify(result, null, 2)}`;
    }),

  "slab__search": (args: any) =>
    Effect.gen(function* () {
      const posts = yield* PostsService;
      const query = args.query as string;
      const results = yield* posts.searchPosts(query);
      return formatSearchResults(results, query);
    }),

  "slab__list_posts": (args: any) =>
    Effect.gen(function* () {
      const posts = yield* PostsService;
      const results = yield* posts.listPosts(args.topicId as string | undefined);
      return formatListResults(results);
    }),
};
```

(Tool definitions list and `createServer` body unchanged for now — Task 5 onwards adds new tools to the list.)

- [ ] **Step 4.1.4: Update `test/client.test.ts` to test the slim transport**

The existing `test/client.test.ts` uses `SlabClientService` to call `getPost`/`updatePost`/etc. Those methods now live on `PostsService`. Either:

(a) Replace `client.getPost(...)` with `posts.getPost(...)` by constructing a `PostsService` test instance, OR
(b) Rename `test/client.test.ts` → `test/posts.test.ts` and provide both layers.

Choose (b): the tests are testing high-level post operations, which is what `PostsService` does. Rename:

```bash
git mv test/client.test.ts test/posts.test.ts
```

Then in `test/posts.test.ts`, replace:

```ts
import type { SlabClientService } from "../src/client.ts";
import { SlabClientServiceLive } from "../src/client.ts";
import type { ConfigService } from "../src/config.ts";

// Mock the global fetch function
const mockFetch = mock();

// Create a test config layer for GraphQL
const TestConfigLayer = Layer.succeed(
  Context.GenericTag<ConfigService>("@services/ConfigService"),
  {
    config: {
      apiToken: "test-token",
      team: "test",
      graphqlUrl: "https://api.slab.com/v1/graphql",
    },
  }
);

describe("SlabClient with GraphQL (Verified Schema)", () => {
  const originalFetch = global.fetch;
  let client: SlabClientService;

  beforeEach(async () => {
    global.fetch = mockFetch as any;
    const program = Effect.gen(function* () {
      return yield* Context.GenericTag<SlabClientService>("@services/SlabClientService");
    });
    client = await Effect.runPromise(
      program.pipe(Effect.provide(SlabClientServiceLive.pipe(Layer.provide(TestConfigLayer))))
    );
  });
```

with:

```ts
import type { SlabClientService } from "../src/client.ts";
import { SlabClientServiceLive } from "../src/client.ts";
import type { PostsService } from "../src/posts.ts";
import { PostsServiceLive } from "../src/posts.ts";
import type { ConfigService } from "../src/config.ts";

const mockFetch = mock();

const TestConfigLayer = Layer.succeed(
  Context.GenericTag<ConfigService>("@services/ConfigService"),
  {
    config: {
      apiToken: "test-token",
      team: "test",
      graphqlUrl: "https://api.slab.com/v1/graphql",
    },
  },
);

describe("PostsService (high-level post ops)", () => {
  const originalFetch = global.fetch;
  let posts: PostsService;

  beforeEach(async () => {
    global.fetch = mockFetch as any;
    const SlabClientLayer = SlabClientServiceLive.pipe(Layer.provide(TestConfigLayer));
    const program = Effect.gen(function* () {
      return yield* Context.GenericTag<PostsService>("@services/PostsService");
    });
    posts = await Effect.runPromise(
      program.pipe(Effect.provide(PostsServiceLive.pipe(Layer.provide(SlabClientLayer)))),
    );
  });
```

Then **rename every `client.xxx(...)` call to `posts.xxx(...)`** in the same file. Find-and-replace `client\.` → `posts.`.

There's one more change required: the old test for `updatePost` called `client.updatePost(postId, content)` where `content` was a string. The new shape is `posts.updatePostContent(postId, delta)`. Since the test was asserting that a Delta with `ops` is sent, replace the test body to call the new shape: pass a fixture Delta, assert the mutation is invoked with it.

Replace the entire `describe("updatePost", ...)` block in `test/posts.test.ts` with:

```ts
  describe("updatePostContent", () => {
    test("sends the provided Delta to UpdatePostContent mutation", async () => {
      const mockUpdateResponse = {
        data: {
          updatePostContent: {
            id: "123",
            title: "Test Post",
            content: [{ insert: "Updated content" }, { insert: "\n\n" }],
            updatedAt: "2024-01-03T00:00:00Z",
          },
        },
      };
      mockFetch.mockResolvedValue({ ok: true, json: async () => mockUpdateResponse });

      const delta = { ops: [{ delete: 12 }, { insert: "Updated content\n\n" }] } as any;
      const result = await Effect.runPromise(posts.updatePostContent("123", delta));

      expect(result.content).toBe("Updated content");
      const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body);
      expect(body.query).toContain("UpdatePostContent");
      expect(body.variables).toEqual({ id: "123", delta });
    });
  });
```

- [ ] **Step 4.1.5: Add a minimal new `test/client.test.ts` covering the transport itself**

Create `test/client.test.ts`:

```ts
import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import { Effect, Layer, Context } from "effect";
import type { SlabClientService } from "../src/client.ts";
import { SlabClientServiceLive } from "../src/client.ts";
import type { ConfigService } from "../src/config.ts";

const mockFetch = mock();

const TestConfigLayer = Layer.succeed(
  Context.GenericTag<ConfigService>("@services/ConfigService"),
  {
    config: {
      apiToken: "test-token",
      team: "test",
      graphqlUrl: "https://api.slab.com/v1/graphql",
    },
  },
);

describe("SlabClientService transport", () => {
  const originalFetch = global.fetch;
  let client: SlabClientService;

  beforeEach(async () => {
    global.fetch = mockFetch as any;
    const program = Effect.gen(function* () {
      return yield* Context.GenericTag<SlabClientService>("@services/SlabClientService");
    });
    client = await Effect.runPromise(
      program.pipe(Effect.provide(SlabClientServiceLive.pipe(Layer.provide(TestConfigLayer)))),
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    mockFetch.mockClear();
  });

  test("sends Bearer auth header and JSON body", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ data: { ok: true } }) });

    const result = await Effect.runPromise(client.request<{ ok: boolean }>("query Q { ok }", { x: 1 }));

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.slab.com/v1/graphql",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ query: "query Q { ok }", variables: { x: 1 } }),
      }),
    );
  });

  test("surfaces GraphQL errors as SlabApiError", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ errors: [{ message: "boom" }] }),
    });

    const result = await Effect.runPromise(client.request("query Q { ok }").pipe(Effect.either));
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("SlabApiError");
      expect(result.left.message).toContain("boom");
    }
  });

  test("surfaces non-2xx HTTP as SlabApiError with status", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403, text: async () => "nope" });

    const result = await Effect.runPromise(client.request("query Q { ok }").pipe(Effect.either));
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("SlabApiError");
      expect(result.left.message).toContain("403");
    }
  });

  test("surfaces fetch failure as SlabNetworkError", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await Effect.runPromise(client.request("query Q { ok }").pipe(Effect.either));
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("SlabNetworkError");
    }
  });
});
```

- [ ] **Step 4.1.6: Run all tests**

```bash
bun test
```

Expected: previous post-level tests pass in `test/posts.test.ts` (now exercising `PostsService`), and the new `test/client.test.ts` transport tests pass. Total existing + new tests all green.

If anything fails, the likely cause is a missed `client.` → `posts.` rename or an Effect type mismatch on the rewired layers. Fix and re-run.

- [ ] **Step 4.1.7: Commit**

```bash
git add src/client.ts src/posts.ts src/index.ts test/client.test.ts test/posts.test.ts
git commit -m "refactor: split client into transport + PostsService; introduce SlabClientLayer"
```

---

## Task 5: New edit tools

**Spec reference:** §4 Layer C (`slab__edit_post`, `slab__append_to_post`, `slab__replace_section`, `slab__update_post`), §8 tool-payload tests.

**Files:**
- Create: `src/tools/posts.ts` (tool definitions + handlers — first cut, holds only the 4 edit tools)
- Modify: `src/posts.ts` (add helper methods that use the new builders)
- Modify: `src/index.ts` (register the new tools, drop the old `slab__update_post` placeholder)
- Modify: `test/posts.test.ts` (add tests for the new helper methods)

### 5.1: Add helper methods on `PostsService` for each edit shape

- [ ] **Step 5.1.1: Extend the service interface**

In `src/posts.ts`, extend the interface:

```ts
import {
  buildFindReplaceDelta,
  buildAppendDelta,
  buildSectionReplaceDelta,
  buildFullReplaceDelta,
  DeltaEditError,
} from "./delta/edits.ts";

export type PostsError = SlabApiError | SlabNetworkError | DeltaConversionError | DeltaEditError;

export interface PostsService {
  readonly getPost: (postId: string) => Effect.Effect<SlabPost, PostsError>;
  readonly updatePostContent: (postId: string, delta: DeltaShape) => Effect.Effect<SlabPost, PostsError>;
  readonly searchPosts: (query: string) => Effect.Effect<SlabSearchResult, PostsError>;
  readonly listPosts: (topicId?: string) => Effect.Effect<SlabListResult, PostsError>;

  readonly editPost: (postId: string, oldText: string, newText: string) => Effect.Effect<SlabPost, PostsError>;
  readonly appendToPost: (postId: string, markdown: string) => Effect.Effect<SlabPost, PostsError>;
  readonly replaceSection: (postId: string, heading: string, markdown: string) => Effect.Effect<SlabPost, PostsError>;
  readonly fullReplacePost: (postId: string, markdown: string) => Effect.Effect<SlabPost, PostsError>;
}
```

- [ ] **Step 5.1.2: Implement them by composing a get + builder + updatePostContent**

Add a helper inside `PostsServiceLive` that fetches the raw Delta (not markdown-projected):

```ts
const fetchRawContent = (transport: SlabClientService["request"], postId: string) =>
  Effect.gen(function* () {
    const data = yield* transport<{ post: { content: any } }>(GET_POST_QUERY, { id: postId });
    return { ops: Array.isArray(data.post.content) ? data.post.content : (data.post.content?.ops ?? []) } as DeltaShape;
  });
```

Then in the returned service object, add (after the existing four operations):

```ts
      editPost: (postId, oldText, newText) =>
        Effect.gen(function* () {
          const current = yield* fetchRawContent(transport.request, postId);
          const patch = yield* buildFindReplaceDelta(current, oldText, newText);
          return yield* this.updatePostContent(postId, patch);
        }),

      appendToPost: (postId, markdown) =>
        Effect.gen(function* () {
          const current = yield* fetchRawContent(transport.request, postId);
          const patch = yield* buildAppendDelta(current, markdown);
          return yield* this.updatePostContent(postId, patch);
        }),

      replaceSection: (postId, heading, markdown) =>
        Effect.gen(function* () {
          const current = yield* fetchRawContent(transport.request, postId);
          const patch = yield* buildSectionReplaceDelta(current, heading, markdown);
          return yield* this.updatePostContent(postId, patch);
        }),

      fullReplacePost: (postId, markdown) =>
        Effect.gen(function* () {
          const current = yield* fetchRawContent(transport.request, postId);
          const patch = yield* buildFullReplaceDelta(current, markdown);
          return yield* this.updatePostContent(postId, patch);
        }),
```

Caveat: `this.updatePostContent` inside the object literal isn't reliable across Effect generators. Refactor by hoisting `updatePostContent` to a top-level function in the `Layer.effect` block:

```ts
    const updatePostContent = (postId: string, delta: DeltaShape) =>
      Effect.gen(function* () {
        const data = yield* transport.request<{ updatePostContent: any }>(
          UPDATE_POST_CONTENT_MUTATION,
          { id: postId, delta },
        );
        return yield* transformPost(data.updatePostContent);
      });
```

Then reference `updatePostContent(...)` (not `this.updatePostContent(...)`) from each helper.

Rewrite the returned service as:

```ts
    return {
      getPost: (postId) =>
        Effect.gen(function* () {
          const data = yield* transport.request<{ post: any }>(GET_POST_QUERY, { id: postId });
          return yield* transformPost(data.post);
        }),

      updatePostContent,

      searchPosts: (query) =>
        Effect.gen(function* () {
          const data = yield* transport.request<{ search: any }>(SEARCH_POSTS_QUERY, { query, first: 20 });
          const edges: any[] = data.search.edges || [];
          const posts: SlabPost[] = yield* Effect.all(
            edges.filter((e) => e.node?.post).map((e) => transformPost(e.node.post)),
          );
          return { posts, total_count: posts.length };
        }),

      listPosts: (topicId) =>
        Effect.gen(function* () {
          if (topicId) {
            const data = yield* transport.request<{ topic: any }>(GET_TOPIC_POSTS_QUERY, { topicId });
            const raw: any[] = data.topic.posts || [];
            const posts: SlabPost[] = yield* Effect.all(raw.map(transformPost));
            return { posts, total_count: posts.length };
          }
          const data = yield* transport.request<{ organization: any }>(GET_ORGANIZATION_POSTS_QUERY, {});
          const raw: any[] = data.organization.posts || [];
          const posts: SlabPost[] = yield* Effect.all(raw.map(transformPost));
          return { posts, total_count: posts.length };
        }),

      editPost: (postId, oldText, newText) =>
        Effect.gen(function* () {
          const current = yield* fetchRawContent(transport.request, postId);
          const patch = yield* buildFindReplaceDelta(current, oldText, newText);
          return yield* updatePostContent(postId, patch);
        }),

      appendToPost: (postId, markdown) =>
        Effect.gen(function* () {
          const current = yield* fetchRawContent(transport.request, postId);
          const patch = yield* buildAppendDelta(current, markdown);
          return yield* updatePostContent(postId, patch);
        }),

      replaceSection: (postId, heading, markdown) =>
        Effect.gen(function* () {
          const current = yield* fetchRawContent(transport.request, postId);
          const patch = yield* buildSectionReplaceDelta(current, heading, markdown);
          return yield* updatePostContent(postId, patch);
        }),

      fullReplacePost: (postId, markdown) =>
        Effect.gen(function* () {
          const current = yield* fetchRawContent(transport.request, postId);
          const patch = yield* buildFullReplaceDelta(current, markdown);
          return yield* updatePostContent(postId, patch);
        }),
    };
```

- [ ] **Step 5.1.3: Add a test for `editPost` payload**

In `test/posts.test.ts`, append:

```ts
  describe("editPost", () => {
    test("fetches current content then sends find/replace Delta", async () => {
      const getResp = {
        data: {
          post: {
            id: "p1",
            title: "T",
            content: [{ insert: "Hello world.\n" }],
            insertedAt: "2024-01-01T00:00:00Z",
            updatedAt: "2024-01-01T00:00:00Z",
          },
        },
      };
      const updateResp = {
        data: {
          updatePostContent: {
            id: "p1",
            title: "T",
            content: [{ insert: "Hello Slab.\n" }],
            updatedAt: "2024-01-02T00:00:00Z",
          },
        },
      };
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => getResp })
        .mockResolvedValueOnce({ ok: true, json: async () => updateResp });

      const result = await Effect.runPromise(posts.editPost("p1", "world", "Slab"));
      expect(result.content).toBe("Hello Slab.");
      const updateCall = mockFetch.mock.calls[1];
      const body = JSON.parse(updateCall?.[1]?.body);
      expect(body.variables.delta).toEqual({
        ops: [{ retain: 6 }, { delete: 5 }, { insert: "Slab" }],
      });
    });

    test("propagates DeltaEditError as a tagged failure", async () => {
      const getResp = {
        data: {
          post: {
            id: "p1",
            title: "T",
            content: [{ insert: "Hello world.\n" }],
            insertedAt: "2024-01-01T00:00:00Z",
            updatedAt: "2024-01-01T00:00:00Z",
          },
        },
      };
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => getResp });

      const result = await Effect.runPromise(posts.editPost("p1", "absent", "x").pipe(Effect.either));
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("DeltaEditError");
        expect((result.left as any).kind).toBe("not_found");
      }
    });
  });
```

- [ ] **Step 5.1.4: Run tests**

```bash
bun test test/posts.test.ts
```

Expected: existing tests pass; 2 new `editPost` tests pass.

- [ ] **Step 5.1.5: Commit**

```bash
git add src/posts.ts test/posts.test.ts
git commit -m "feat(posts): add editPost/appendToPost/replaceSection/fullReplacePost helpers"
```

### 5.2: Add MCP tool definitions

- [ ] **Step 5.2.1: Create `src/tools/posts.ts`**

```ts
/**
 * MCP tool definitions for post-related slabby tools. Each export pairs a
 * tool descriptor with its handler. `src/index.ts` collects these into the
 * MCP server's tool list.
 */

import { Effect } from "effect";
import { PostsService } from "../posts.ts";
import { extractPostId } from "../utils.ts";
import { formatPostResponse } from "../formatters.ts";

export interface ToolModule {
  definition: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  };
  handler: (args: any) => Effect.Effect<string, any, PostsService>;
}

export const editPost: ToolModule = {
  definition: {
    name: "slab__edit_post",
    description:
      "PREFER THIS for small or targeted edits. Replace one exact substring (oldText) in a Slab post's content with newText. oldText must be unique in the post, must be contained within a single formatting run (no spanning bold/plain/code boundaries), and is matched literally including whitespace. Returns the updated post.",
    inputSchema: {
      type: "object",
      properties: {
        postId: { type: "string", description: "Slab post ID or URL." },
        oldText: { type: "string", description: "Exact substring to find. Must be unique and within a single formatting run." },
        newText: { type: "string", description: "Replacement text. Inherits the matched run's formatting attributes." },
      },
      required: ["postId", "oldText", "newText"],
    },
  },
  handler: (args) =>
    Effect.gen(function* () {
      const posts = yield* PostsService;
      const postId = yield* extractPostId(args.postId as string);
      const post = yield* posts.editPost(postId, args.oldText as string, args.newText as string);
      return formatPostResponse(post);
    }),
};

export const appendToPost: ToolModule = {
  definition: {
    name: "slab__append_to_post",
    description:
      "Append markdown content to the end of a Slab post. Inserts at least two newlines between the existing content and the appended content. Use for adding new sections/paragraphs without touching existing content.",
    inputSchema: {
      type: "object",
      properties: {
        postId: { type: "string", description: "Slab post ID or URL." },
        content: { type: "string", description: "Markdown content to append." },
      },
      required: ["postId", "content"],
    },
  },
  handler: (args) =>
    Effect.gen(function* () {
      const posts = yield* PostsService;
      const postId = yield* extractPostId(args.postId as string);
      const post = yield* posts.appendToPost(postId, args.content as string);
      return formatPostResponse(post);
    }),
};

export const replaceSection: ToolModule = {
  definition: {
    name: "slab__replace_section",
    description:
      "Replace the body of a specific section identified by its heading. The heading line itself is preserved; the body between this heading and the next heading of the same or higher level (or end-of-document) is replaced with the supplied markdown. heading must match a unique heading line in the post.",
    inputSchema: {
      type: "object",
      properties: {
        postId: { type: "string", description: "Slab post ID or URL." },
        heading: { type: "string", description: "Exact heading text (without leading #s)." },
        content: { type: "string", description: "Markdown content to insert as the new section body." },
      },
      required: ["postId", "heading", "content"],
    },
  },
  handler: (args) =>
    Effect.gen(function* () {
      const posts = yield* PostsService;
      const postId = yield* extractPostId(args.postId as string);
      const post = yield* posts.replaceSection(postId, args.heading as string, args.content as string);
      return formatPostResponse(post);
    }),
};

export const updatePost: ToolModule = {
  definition: {
    name: "slab__update_post",
    description:
      "Full-document rewrite. Use only for total replacement; prefer slab__edit_post for partial changes. Constructs not expressible in markdown (e.g. tables, certain embed attributes) may be lost on a full update — use the targeted edit tools to avoid touching those regions.",
    inputSchema: {
      type: "object",
      properties: {
        postId: { type: "string", description: "Slab post ID or URL." },
        content: { type: "string", description: "Full replacement markdown." },
      },
      required: ["postId", "content"],
    },
  },
  handler: (args) =>
    Effect.gen(function* () {
      const posts = yield* PostsService;
      const postId = yield* extractPostId(args.postId as string);
      const post = yield* posts.fullReplacePost(postId, args.content as string);
      return formatPostResponse(post);
    }),
};

export const allPostEditTools: ToolModule[] = [editPost, appendToPost, replaceSection, updatePost];
```

- [ ] **Step 5.2.2: Update `src/index.ts` to register these tools**

Replace the `toolHandlers` map and the tool-list block in `src/index.ts`. Import:

```ts
import { allPostEditTools } from "./tools/posts.ts";
```

Replace the existing `toolHandlers` map with:

```ts
const editToolHandlers: Record<string, (args: any) => Effect.Effect<string, any, PostsService>> = Object.fromEntries(
  allPostEditTools.map((t) => [t.definition.name, t.handler]),
);

// Existing search + list_posts handlers stay inline for now (they move in Task 7).
const inlineHandlers = {
  "slab__search": (args: any) =>
    Effect.gen(function* () {
      const posts = yield* PostsService;
      const results = yield* posts.searchPosts(args.query as string);
      return formatSearchResults(results, args.query as string);
    }),

  "slab__list_posts": (args: any) =>
    Effect.gen(function* () {
      const posts = yield* PostsService;
      const results = yield* posts.listPosts(args.topicId as string | undefined);
      return formatListResults(results);
    }),
};

const toolHandlers: Record<string, (args: any) => Effect.Effect<string, any, PostsService>> = {
  ...editToolHandlers,
  ...inlineHandlers,
};
```

Replace the inline list of tools inside `ListToolsRequestSchema` with:

```ts
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        ...allPostEditTools.map((t) => t.definition),
        {
          name: "slab__search",
          description: "Search for posts across your Slab workspace",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string", description: "Search query string" } },
            required: ["query"],
          },
        },
        {
          name: "slab__list_posts",
          description: "List posts in your Slab workspace, optionally filtered by topic",
          inputSchema: {
            type: "object",
            properties: { topicId: { type: "string", description: "Optional topic ID to filter posts" } },
          },
        },
      ],
    };
  });
```

Also remove the old `slab__get_post` entry — it's preserved as `slab__get_post` via the existing handler shape but with the new tools list it's no longer registered. Add it back to `allPostEditTools` or as an inline entry alongside `slab__search`. Easiest: leave a `getPost` module alongside the edit tools.

Add to `src/tools/posts.ts`:

```ts
export const getPost: ToolModule = {
  definition: {
    name: "slab__get_post",
    description: "Fetch a Slab post by ID or URL. Returns the post content in markdown format.",
    inputSchema: {
      type: "object",
      properties: {
        postId: {
          type: "string",
          description: "The Slab post ID or full post URL (e.g. 'abc123' or 'https://team.slab.com/posts/abc123')",
        },
      },
      required: ["postId"],
    },
  },
  handler: (args) =>
    Effect.gen(function* () {
      const posts = yield* PostsService;
      const postId = yield* extractPostId(args.postId as string);
      const post = yield* posts.getPost(postId);
      return formatPostResponse(post);
    }),
};

export const allPostReadTools: ToolModule[] = [getPost];
```

Update `allPostEditTools` to remain edit-only, and in `src/index.ts` import both:

```ts
import { allPostEditTools, allPostReadTools } from "./tools/posts.ts";
```

Then in the tool-list and handler map, include both:

```ts
const toolHandlers = Object.fromEntries(
  [...allPostReadTools, ...allPostEditTools].map((t) => [t.definition.name, t.handler]),
);
// (then layered on top, the inline search + list_posts entries)
```

And in the list:

```ts
        ...allPostReadTools.map((t) => t.definition),
        ...allPostEditTools.map((t) => t.definition),
```

- [ ] **Step 5.2.3: Run tests; smoke-run the server briefly**

```bash
bun test
```

Expected: all tests pass.

```bash
SLAB_API_TOKEN=dummy SLAB_TEAM=dummy timeout 2s bun run src/index.ts < /dev/null
```

Expected: server starts, prints "Slabby MCP server running on stdio" to stderr, then exits via timeout. No exceptions before timeout.

- [ ] **Step 5.2.4: Commit**

```bash
git add src/tools/ src/index.ts
git commit -m "feat(tools): wire edit_post/append_to_post/replace_section/update_post MCP tools"
```

---

## Task 6: Other post mutations (state, create, sync, topic link)

**Spec reference:** §5 mutation coverage table — `set_post_state`, `create_post`, `sync_post`, `add_topic_to_post`, `remove_topic_from_post`. §7 error handling (create_post mutual exclusion).

**Files:**
- Modify: `src/graphql.ts` (add new mutation strings)
- Modify: `src/posts.ts` (add service methods)
- Modify: `src/tools/posts.ts` (add tool modules)
- Modify: `src/index.ts` (register new tools)
- Modify: `src/types.ts` (add enums + state arg types)
- Modify: `test/posts.test.ts` (add tests)

### 6.1: Add GraphQL mutation strings

- [ ] **Step 6.1.1: Append to `src/graphql.ts`**

```ts
export const CREATE_POST_MUTATION = `
  mutation CreatePost($title: String, $topicId: ID, $templateId: ID) {
    createPost(title: $title, topicId: $topicId, templateId: $templateId) {
      id
      title
      content
      insertedAt
      updatedAt
      publishedAt
      archivedAt
      version
      owner { id name email }
    }
  }
`;

export const UPDATE_POST_STATE_MUTATION = `
  mutation UpdatePostState(
    $id: ID!,
    $ownerId: ID,
    $archived: Boolean,
    $published: Boolean,
    $linkAccess: PostLinkAccess,
    $bannerUrl: String
  ) {
    updatePost(
      id: $id,
      ownerId: $ownerId,
      archived: $archived,
      published: $published,
      linkAccess: $linkAccess,
      bannerUrl: $bannerUrl
    ) {
      id
      title
      publishedAt
      archivedAt
      linkAccess
      version
      owner { id name email }
    }
  }
`;

export const SYNC_POST_MUTATION = `
  mutation SyncPost(
    $externalId: ID!,
    $format: PostContentFormat!,
    $content: String!,
    $editUrl: String,
    $readUrl: String
  ) {
    syncPost(
      externalId: $externalId,
      format: $format,
      content: $content,
      editUrl: $editUrl,
      readUrl: $readUrl
    ) {
      id
      title
      insertedAt
      updatedAt
      version
    }
  }
`;

export const ADD_TOPIC_TO_POST_MUTATION = `
  mutation AddTopicToPost($postId: ID!, $topicId: ID!) {
    addTopicToPost(postId: $postId, topicId: $topicId) {
      id
      name
    }
  }
`;

export const REMOVE_TOPIC_FROM_POST_MUTATION = `
  mutation RemoveTopicFromPost($postId: ID!, $topicId: ID!) {
    removeTopicFromPost(postId: $postId, topicId: $topicId) {
      id
      name
    }
  }
`;
```

- [ ] **Step 6.1.2: Commit (graphql-only)**

```bash
git add src/graphql.ts
git commit -m "feat(graphql): add createPost/updatePost/syncPost/topic-link mutation strings"
```

### 6.2: Types for state args and enums

- [ ] **Step 6.2.1: Extend `src/types.ts`**

Append:

```ts
export type PostLinkAccess = "INTERNAL" | "INTERNAL_VIEW" | "PUBLIC" | "PUBLIC_EDIT" | "DISABLED";
export type PostContentFormat = "HTML" | "MARKDOWN";

export interface SlabPostStateUpdate {
  postId: string;
  ownerId?: string;
  archived?: boolean;
  published?: boolean;
  linkAccess?: PostLinkAccess;
  bannerUrl?: string;
}

export interface SlabCreatePostInput {
  title: string;
  topicId?: string;
  content?: string;     // mutually exclusive with templateId
  templateId?: string;
}

export interface SlabSyncPostInput {
  externalId: string;
  format: PostContentFormat;
  content: string;
  editUrl: string;
  readUrl?: string;
}
```

### 6.3: Service methods

- [ ] **Step 6.3.1: Extend `PostsService` interface in `src/posts.ts`**

Add the imports:

```ts
import {
  CREATE_POST_MUTATION,
  UPDATE_POST_STATE_MUTATION,
  SYNC_POST_MUTATION,
  ADD_TOPIC_TO_POST_MUTATION,
  REMOVE_TOPIC_FROM_POST_MUTATION,
} from "./graphql.ts";
import { markdownToDelta } from "./delta/markdown-to-delta.ts";
import type {
  SlabPostStateUpdate,
  SlabCreatePostInput,
  SlabSyncPostInput,
} from "./types.ts";
```

Add a new tagged error for the mutual-exclusion failure:

```ts
export class CreatePostInvalidArgsError extends Data.TaggedError("CreatePostInvalidArgsError")<{
  readonly message: string;
}> {}

export type PostsError =
  | SlabApiError
  | SlabNetworkError
  | DeltaConversionError
  | DeltaEditError
  | CreatePostInvalidArgsError;
```

Extend the interface:

```ts
export interface PostsService {
  // ... existing methods ...
  readonly createPost: (input: SlabCreatePostInput) => Effect.Effect<SlabPost, PostsError>;
  readonly setPostState: (input: SlabPostStateUpdate) => Effect.Effect<SlabPost, PostsError>;
  readonly syncPost: (input: SlabSyncPostInput) => Effect.Effect<SlabPost, PostsError>;
  readonly addTopicToPost: (postId: string, topicId: string) => Effect.Effect<{ id: string; name: string }, PostsError>;
  readonly removeTopicFromPost: (postId: string, topicId: string) => Effect.Effect<{ id: string; name: string }, PostsError>;
}
```

Implement each, inside the `Layer.effect`'s returned object:

```ts
      createPost: (input) =>
        Effect.gen(function* () {
          if (input.templateId && input.content) {
            return yield* Effect.fail(new CreatePostInvalidArgsError({
              message: "create_post: pass templateId OR content, not both. Use templateId for a templated post and edit_post afterward to add content; use content for a blank post seeded with content.",
            }));
          }
          const data = yield* transport.request<{ createPost: any }>(CREATE_POST_MUTATION, {
            title: input.title,
            topicId: input.topicId ?? null,
            templateId: input.templateId ?? null,
          });
          const created = data.createPost;
          if (input.content) {
            const delta = yield* markdownToDelta(input.content).pipe(
              Effect.mapError((e) => new DeltaEditError({
                kind: "parse_failure",
                message: `failed to parse create_post content: ${e.message}`,
              })),
            );
            return yield* updatePostContent(created.id, delta);
          }
          return yield* transformPost(created);
        }),

      setPostState: (input) =>
        Effect.gen(function* () {
          const data = yield* transport.request<{ updatePost: any }>(UPDATE_POST_STATE_MUTATION, {
            id: input.postId,
            ownerId: input.ownerId ?? null,
            archived: input.archived ?? null,
            published: input.published ?? null,
            linkAccess: input.linkAccess ?? null,
            bannerUrl: input.bannerUrl ?? null,
          });
          return yield* transformPost(data.updatePost);
        }),

      syncPost: (input) =>
        Effect.gen(function* () {
          const data = yield* transport.request<{ syncPost: any }>(SYNC_POST_MUTATION, {
            externalId: input.externalId,
            format: input.format,
            content: input.content,
            editUrl: input.editUrl,
            readUrl: input.readUrl ?? null,
          });
          return yield* transformPost(data.syncPost);
        }),

      addTopicToPost: (postId, topicId) =>
        Effect.gen(function* () {
          const data = yield* transport.request<{ addTopicToPost: { id: string; name: string } }>(
            ADD_TOPIC_TO_POST_MUTATION,
            { postId, topicId },
          );
          return data.addTopicToPost;
        }),

      removeTopicFromPost: (postId, topicId) =>
        Effect.gen(function* () {
          const data = yield* transport.request<{ removeTopicFromPost: { id: string; name: string } }>(
            REMOVE_TOPIC_FROM_POST_MUTATION,
            { postId, topicId },
          );
          return data.removeTopicFromPost;
        }),
```

### 6.4: Service tests

- [ ] **Step 6.4.1: Append tests for each new method to `test/posts.test.ts`**

```ts
  describe("createPost", () => {
    test("rejects templateId + content combination", async () => {
      const result = await Effect.runPromise(
        posts.createPost({ title: "x", templateId: "t1", content: "body" }).pipe(Effect.either),
      );
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("CreatePostInvalidArgsError");
      }
    });

    test("creates a blank post with title + topicId", async () => {
      const createResp = {
        data: {
          createPost: {
            id: "new1",
            title: "Title",
            content: [],
            insertedAt: "2024-01-01T00:00:00Z",
            updatedAt: "2024-01-01T00:00:00Z",
          },
        },
      };
      mockFetch.mockResolvedValue({ ok: true, json: async () => createResp });

      const result = await Effect.runPromise(
        posts.createPost({ title: "Title", topicId: "tpc" }),
      );
      expect(result.id).toBe("new1");
      const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body);
      expect(body.query).toContain("CreatePost");
      expect(body.variables).toEqual({ title: "Title", topicId: "tpc", templateId: null });
    });

    test("creates a post and patches body when content provided", async () => {
      const createResp = {
        data: {
          createPost: {
            id: "new2",
            title: "T",
            content: [],
            insertedAt: "2024-01-01T00:00:00Z",
            updatedAt: "2024-01-01T00:00:00Z",
          },
        },
      };
      const updateResp = {
        data: {
          updatePostContent: {
            id: "new2",
            title: "T",
            content: [{ insert: "hello" }, { insert: "\n" }],
            updatedAt: "2024-01-01T00:00:00Z",
          },
        },
      };
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => createResp })
        .mockResolvedValueOnce({ ok: true, json: async () => updateResp });

      const result = await Effect.runPromise(posts.createPost({ title: "T", content: "hello" }));
      expect(result.content).toBe("hello");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("setPostState", () => {
    test("sends only the fields provided (nulls for absent)", async () => {
      const updateResp = {
        data: {
          updatePost: {
            id: "p1",
            title: "T",
            content: [],
            insertedAt: "2024-01-01T00:00:00Z",
            updatedAt: "2024-01-02T00:00:00Z",
          },
        },
      };
      mockFetch.mockResolvedValue({ ok: true, json: async () => updateResp });

      await Effect.runPromise(posts.setPostState({ postId: "p1", archived: true }));
      const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body);
      expect(body.query).toContain("UpdatePostState");
      expect(body.variables).toEqual({
        id: "p1",
        ownerId: null,
        archived: true,
        published: null,
        linkAccess: null,
        bannerUrl: null,
      });
    });
  });

  describe("syncPost", () => {
    test("passes externalId/format/content/editUrl through", async () => {
      const resp = {
        data: {
          syncPost: {
            id: "s1",
            title: "Synced",
            content: [],
            insertedAt: "2024-01-01T00:00:00Z",
            updatedAt: "2024-01-01T00:00:00Z",
          },
        },
      };
      mockFetch.mockResolvedValue({ ok: true, json: async () => resp });

      const result = await Effect.runPromise(posts.syncPost({
        externalId: "ext-1",
        format: "MARKDOWN",
        content: "# Hi",
        editUrl: "https://src/example",
      }));
      expect(result.id).toBe("s1");
      const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body);
      expect(body.variables).toEqual({
        externalId: "ext-1",
        format: "MARKDOWN",
        content: "# Hi",
        editUrl: "https://src/example",
        readUrl: null,
      });
    });
  });

  describe("addTopicToPost / removeTopicFromPost", () => {
    test("addTopicToPost returns the topic", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: { addTopicToPost: { id: "t1", name: "Eng" } } }),
      });
      const t = await Effect.runPromise(posts.addTopicToPost("p1", "t1"));
      expect(t).toEqual({ id: "t1", name: "Eng" });
    });

    test("removeTopicFromPost returns the topic", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: { removeTopicFromPost: { id: "t1", name: "Eng" } } }),
      });
      const t = await Effect.runPromise(posts.removeTopicFromPost("p1", "t1"));
      expect(t).toEqual({ id: "t1", name: "Eng" });
    });
  });
```

- [ ] **Step 6.4.2: Run tests**

```bash
bun test test/posts.test.ts
```

Expected: all existing + new tests pass.

- [ ] **Step 6.4.3: Commit**

```bash
git add src/graphql.ts src/types.ts src/posts.ts test/posts.test.ts
git commit -m "feat(posts): add createPost/setPostState/syncPost/topic-link service methods"
```

### 6.5: Tool definitions and registration

- [ ] **Step 6.5.1: Add tool modules to `src/tools/posts.ts`**

Append:

```ts
export const createPost: ToolModule = {
  definition: {
    name: "slab__create_post",
    description:
      "Create a new Slab post. Provide title (required), and optionally topicId, content (markdown), or templateId. content and templateId are mutually exclusive — pick at most one.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Post title." },
        topicId: { type: "string", description: "Optional topic to place the post under." },
        content: { type: "string", description: "Optional initial body as markdown. Mutually exclusive with templateId." },
        templateId: { type: "string", description: "Optional template id to seed the post body. Mutually exclusive with content." },
      },
      required: ["title"],
    },
  },
  handler: (args) =>
    Effect.gen(function* () {
      const posts = yield* PostsService;
      const post = yield* posts.createPost({
        title: args.title as string,
        topicId: args.topicId as string | undefined,
        content: args.content as string | undefined,
        templateId: args.templateId as string | undefined,
      });
      return formatPostResponse(post);
    }),
};

export const setPostState: ToolModule = {
  definition: {
    name: "slab__set_post_state",
    description:
      "Update a Slab post's state without changing its content: archive/unarchive, publish/unpublish, change link access, transfer ownership, change banner. All fields except postId are optional; only those provided are sent. Note: there is no delete_post tool — archive a post via {archived: true} instead.",
    inputSchema: {
      type: "object",
      properties: {
        postId: { type: "string", description: "Slab post ID or URL." },
        ownerId: { type: "string", description: "Transfer ownership to this user ID." },
        archived: { type: "boolean", description: "true to archive, false to unarchive." },
        published: { type: "boolean", description: "true to publish, false to unpublish." },
        linkAccess: {
          type: "string",
          enum: ["INTERNAL", "INTERNAL_VIEW", "PUBLIC", "PUBLIC_EDIT", "DISABLED"],
          description: "Post link access level.",
        },
        bannerUrl: { type: "string", description: "URL of a banner image." },
      },
      required: ["postId"],
    },
  },
  handler: (args) =>
    Effect.gen(function* () {
      const posts = yield* PostsService;
      const postId = yield* extractPostId(args.postId as string);
      const post = yield* posts.setPostState({
        postId,
        ownerId: args.ownerId as string | undefined,
        archived: args.archived as boolean | undefined,
        published: args.published as boolean | undefined,
        linkAccess: args.linkAccess as any,
        bannerUrl: args.bannerUrl as string | undefined,
      });
      return formatPostResponse(post);
    }),
};

export const syncPost: ToolModule = {
  definition: {
    name: "slab__sync_post",
    description:
      "Create or update a Slab post that mirrors content from an external source (e.g. a GitHub README). The resulting post is READ-ONLY in Slab — Slab users cannot edit it. Use this when the source of truth lives outside Slab. format must be 'MARKDOWN' or 'HTML'.",
    inputSchema: {
      type: "object",
      properties: {
        externalId: { type: "string", description: "Caller-stable id for the external source." },
        format: { type: "string", enum: ["MARKDOWN", "HTML"], description: "Content format." },
        content: { type: "string", description: "Full content in the chosen format." },
        editUrl: { type: "string", description: "Link to edit the source." },
        readUrl: { type: "string", description: "Optional read-only link; defaults to editUrl." },
      },
      required: ["externalId", "format", "content", "editUrl"],
    },
  },
  handler: (args) =>
    Effect.gen(function* () {
      const posts = yield* PostsService;
      const post = yield* posts.syncPost({
        externalId: args.externalId as string,
        format: args.format as any,
        content: args.content as string,
        editUrl: args.editUrl as string,
        readUrl: args.readUrl as string | undefined,
      });
      return formatPostResponse(post);
    }),
};

export const addTopicToPost: ToolModule = {
  definition: {
    name: "slab__add_topic_to_post",
    description: "Attach a topic to a post.",
    inputSchema: {
      type: "object",
      properties: {
        postId: { type: "string", description: "Slab post ID or URL." },
        topicId: { type: "string", description: "Topic ID to attach." },
      },
      required: ["postId", "topicId"],
    },
  },
  handler: (args) =>
    Effect.gen(function* () {
      const posts = yield* PostsService;
      const postId = yield* extractPostId(args.postId as string);
      const topic = yield* posts.addTopicToPost(postId, args.topicId as string);
      return `Topic attached. Post: ${postId}, Topic: ${topic.id} (${topic.name})`;
    }),
};

export const removeTopicFromPost: ToolModule = {
  definition: {
    name: "slab__remove_topic_from_post",
    description: "Detach a topic from a post.",
    inputSchema: {
      type: "object",
      properties: {
        postId: { type: "string", description: "Slab post ID or URL." },
        topicId: { type: "string", description: "Topic ID to detach." },
      },
      required: ["postId", "topicId"],
    },
  },
  handler: (args) =>
    Effect.gen(function* () {
      const posts = yield* PostsService;
      const postId = yield* extractPostId(args.postId as string);
      const topic = yield* posts.removeTopicFromPost(postId, args.topicId as string);
      return `Topic detached. Post: ${postId}, Topic: ${topic.id} (${topic.name})`;
    }),
};

export const allPostMutationTools: ToolModule[] = [
  createPost,
  setPostState,
  syncPost,
  addTopicToPost,
  removeTopicFromPost,
];
```

- [ ] **Step 6.5.2: Register in `src/index.ts`**

Update the import:

```ts
import { allPostEditTools, allPostReadTools, allPostMutationTools } from "./tools/posts.ts";
```

Update the registration set:

```ts
const allPostTools = [...allPostReadTools, ...allPostEditTools, ...allPostMutationTools];
const toolHandlers: Record<string, (args: any) => Effect.Effect<string, any, PostsService>> = Object.fromEntries(
  allPostTools.map((t) => [t.definition.name, t.handler]),
);
// ... search + list_posts inline handlers same as before ...
```

In the `ListToolsRequestSchema` block:

```ts
        ...allPostTools.map((t) => t.definition),
```

- [ ] **Step 6.5.3: Smoke test**

```bash
bun test
SLAB_API_TOKEN=dummy SLAB_TEAM=dummy timeout 2s bun run src/index.ts < /dev/null
```

Expected: all tests pass; server starts without exception.

- [ ] **Step 6.5.4: Commit**

```bash
git add src/tools/posts.ts src/index.ts
git commit -m "feat(tools): expose create_post/set_post_state/sync_post/topic-link MCP tools"
```

---

## Task 7: Topics service + tools

**Spec reference:** §5 mutation coverage (topic mutations), §6 reads (`get_topic`, `list_topics`), §7 (delete_topic confirm gate).

**Files:**
- Create: `src/topics.ts` (TopicsService)
- Create: `src/tools/topics.ts` (tool modules)
- Create: `src/tools/search.ts` (move existing search/list_posts here so `index.ts` is fully registry-driven)
- Modify: `src/graphql.ts` (add topic queries/mutations)
- Modify: `src/types.ts` (SlabTopic)
- Modify: `src/formatters.ts` (formatTopicResponse, formatTopicList)
- Modify: `src/index.ts` (register topic tools + search tools)
- Create: `test/topics.test.ts`

### 7.1: GraphQL strings

- [ ] **Step 7.1.1: Append to `src/graphql.ts`**

```ts
export const GET_TOPIC_QUERY = `
  query GetTopic($id: ID!) {
    topic(id: $id) {
      id
      name
      description
      privacy
      memberEditable
      inheritParent
      parent { id name }
      ancestors { id name }
      children { id name }
      posts {
        id
        title
        publishedAt
        archivedAt
        linkAccess
      }
      hierarchy
    }
  }
`;

export const LIST_TOPICS_QUERY = `
  query ListTopics {
    organization {
      id
      topics {
        id
        name
        parent { id }
        privacy
      }
    }
  }
`;

export const CREATE_TOPIC_MUTATION = `
  mutation CreateTopic(
    $name: String!,
    $description: Json,
    $parentId: ID,
    $memberEditable: TopicMemberEditable,
    $privacy: TopicPrivacy,
    $inheritParent: Boolean
  ) {
    createTopic(
      name: $name,
      description: $description,
      parentId: $parentId,
      memberEditable: $memberEditable,
      privacy: $privacy,
      inheritParent: $inheritParent
    ) {
      id
      name
    }
  }
`;

export const UPDATE_TOPIC_MUTATION = `
  mutation UpdateTopic(
    $id: ID!,
    $name: String,
    $description: Json,
    $parentId: ID,
    $memberEditable: TopicMemberEditable,
    $privacy: TopicPrivacy,
    $inheritParent: Boolean,
    $propagatePrivacy: Boolean,
    $bannerUrl: String
  ) {
    updateTopic(
      id: $id,
      name: $name,
      description: $description,
      parentId: $parentId,
      memberEditable: $memberEditable,
      privacy: $privacy,
      inheritParent: $inheritParent,
      propagatePrivacy: $propagatePrivacy,
      bannerUrl: $bannerUrl
    ) {
      id
      name
    }
  }
`;

export const DELETE_TOPIC_MUTATION = `
  mutation DeleteTopic($id: ID!) {
    deleteTopic(id: $id) {
      id
      name
    }
  }
`;
```

### 7.2: Types

- [ ] **Step 7.2.1: Append to `src/types.ts`**

```ts
export type TopicPrivacy = "OPEN" | "PRIVATE" | "SECRET" | "PUBLIC";
export type TopicMemberEditable = "ALL" | "POST" | "NONE";

export interface SlabTopicRef {
  id: string;
  name: string;
}

export interface SlabTopicDetails extends SlabTopicRef {
  description?: string;       // rendered markdown
  privacy?: TopicPrivacy;
  memberEditable?: TopicMemberEditable;
  inheritParent?: boolean;
  parent?: SlabTopicRef;
  ancestors?: SlabTopicRef[];
  children?: SlabTopicRef[];
  posts?: Array<{ id: string; title: string; publishedAt?: string; archivedAt?: string; linkAccess?: PostLinkAccess }>;
  hierarchy?: string[];
}

export interface SlabTopicSummary {
  id: string;
  name: string;
  parentId?: string;
  privacy?: TopicPrivacy;
}

export interface SlabCreateTopicInput {
  name: string;
  description?: string;       // markdown, converted to Delta JSON via markdownToDelta
  parentId?: string;
  memberEditable?: TopicMemberEditable;
  privacy?: TopicPrivacy;
  inheritParent?: boolean;
}

export interface SlabUpdateTopicInput {
  topicId: string;
  name?: string;
  description?: string;
  parentId?: string;
  memberEditable?: TopicMemberEditable;
  privacy?: TopicPrivacy;
  inheritParent?: boolean;
  propagatePrivacy?: boolean;
  bannerUrl?: string;
}
```

### 7.3: TopicsService

- [ ] **Step 7.3.1: Create `src/topics.ts`**

```ts
import { Context, Effect, Layer, Data } from "effect";
import { SlabClientService } from "./client.ts";
import type { SlabApiError, SlabNetworkError } from "./client.ts";
import {
  GET_TOPIC_QUERY,
  LIST_TOPICS_QUERY,
  CREATE_TOPIC_MUTATION,
  UPDATE_TOPIC_MUTATION,
  DELETE_TOPIC_MUTATION,
} from "./graphql.ts";
import { contentToMarkdown, DeltaConversionError } from "./delta/delta-to-markdown.ts";
import { markdownToDelta, MarkdownParseError } from "./delta/markdown-to-delta.ts";
import type {
  SlabTopicDetails,
  SlabTopicRef,
  SlabTopicSummary,
  SlabCreateTopicInput,
  SlabUpdateTopicInput,
} from "./types.ts";

export class DeleteTopicConfirmError extends Data.TaggedError("DeleteTopicConfirmError")<{
  readonly message: string;
}> {}

export type TopicsError =
  | SlabApiError
  | SlabNetworkError
  | DeltaConversionError
  | MarkdownParseError
  | DeleteTopicConfirmError;

export interface TopicsService {
  readonly getTopic: (topicId: string) => Effect.Effect<SlabTopicDetails, TopicsError>;
  readonly listTopics: () => Effect.Effect<SlabTopicSummary[], TopicsError>;
  readonly createTopic: (input: SlabCreateTopicInput) => Effect.Effect<SlabTopicRef, TopicsError>;
  readonly updateTopic: (input: SlabUpdateTopicInput) => Effect.Effect<SlabTopicRef, TopicsError>;
  readonly deleteTopic: (topicId: string, confirm: boolean) => Effect.Effect<SlabTopicRef, TopicsError>;
}

export const TopicsService = Context.GenericTag<TopicsService>("@services/TopicsService");

export const TopicsServiceLive = Layer.effect(
  TopicsService,
  Effect.gen(function* () {
    const transport = yield* SlabClientService;

    return {
      getTopic: (topicId) =>
        Effect.gen(function* () {
          const data = yield* transport.request<{ topic: any }>(GET_TOPIC_QUERY, { id: topicId });
          const t = data.topic;
          const description = yield* contentToMarkdown(t.description);
          return {
            id: t.id,
            name: t.name,
            description,
            privacy: t.privacy,
            memberEditable: t.memberEditable,
            inheritParent: t.inheritParent,
            parent: t.parent ? { id: t.parent.id, name: t.parent.name } : undefined,
            ancestors: (t.ancestors ?? []).map((a: any) => ({ id: a.id, name: a.name })),
            children: (t.children ?? []).map((c: any) => ({ id: c.id, name: c.name })),
            posts: (t.posts ?? []).map((p: any) => ({
              id: p.id,
              title: p.title,
              publishedAt: p.publishedAt ?? undefined,
              archivedAt: p.archivedAt ?? undefined,
              linkAccess: p.linkAccess ?? undefined,
            })),
            hierarchy: t.hierarchy ?? [],
          };
        }),

      listTopics: () =>
        Effect.gen(function* () {
          const data = yield* transport.request<{ organization: any }>(LIST_TOPICS_QUERY, {});
          return (data.organization.topics ?? []).map((t: any) => ({
            id: t.id,
            name: t.name,
            parentId: t.parent?.id ?? undefined,
            privacy: t.privacy ?? undefined,
          }));
        }),

      createTopic: (input) =>
        Effect.gen(function* () {
          let description: any = null;
          if (input.description) {
            const delta = yield* markdownToDelta(input.description);
            description = delta;
          }
          const data = yield* transport.request<{ createTopic: SlabTopicRef }>(CREATE_TOPIC_MUTATION, {
            name: input.name,
            description,
            parentId: input.parentId ?? null,
            memberEditable: input.memberEditable ?? null,
            privacy: input.privacy ?? null,
            inheritParent: input.inheritParent ?? null,
          });
          return data.createTopic;
        }),

      updateTopic: (input) =>
        Effect.gen(function* () {
          let description: any = null;
          if (input.description !== undefined) {
            const delta = yield* markdownToDelta(input.description);
            description = delta;
          }
          const data = yield* transport.request<{ updateTopic: SlabTopicRef }>(UPDATE_TOPIC_MUTATION, {
            id: input.topicId,
            name: input.name ?? null,
            description,
            parentId: input.parentId ?? null,
            memberEditable: input.memberEditable ?? null,
            privacy: input.privacy ?? null,
            inheritParent: input.inheritParent ?? null,
            propagatePrivacy: input.propagatePrivacy ?? null,
            bannerUrl: input.bannerUrl ?? null,
          });
          return data.updateTopic;
        }),

      deleteTopic: (topicId, confirm) =>
        Effect.gen(function* () {
          if (confirm !== true) {
            return yield* Effect.fail(new DeleteTopicConfirmError({
              message: "delete_topic requires confirm: true to prevent accidental deletion",
            }));
          }
          const data = yield* transport.request<{ deleteTopic: SlabTopicRef }>(DELETE_TOPIC_MUTATION, { id: topicId });
          return data.deleteTopic;
        }),
    };
  }),
);
```

### 7.4: Formatters

- [ ] **Step 7.4.1: Add `formatTopicResponse` and `formatTopicList` to `src/formatters.ts`**

Append:

```ts
import type { SlabTopicDetails, SlabTopicSummary } from "./types.ts";

export function formatTopicResponse(topic: SlabTopicDetails): string {
  const lines: string[] = [];
  lines.push(`# Topic: ${topic.name}`);
  lines.push("");
  lines.push(`**ID:** ${topic.id}`);
  if (topic.privacy) lines.push(`**Privacy:** ${topic.privacy}`);
  if (topic.parent) lines.push(`**Parent:** ${topic.parent.name} (${topic.parent.id})`);
  if (topic.ancestors && topic.ancestors.length > 0) {
    lines.push(`**Ancestors:** ${topic.ancestors.map((a) => `${a.name} (${a.id})`).join(" / ")}`);
  }
  if (topic.children && topic.children.length > 0) {
    lines.push(`**Children:** ${topic.children.map((c) => `${c.name} (${c.id})`).join(", ")}`);
  }
  if (topic.description) {
    lines.push("");
    lines.push("## Description");
    lines.push("");
    lines.push(topic.description);
  }
  if (topic.posts && topic.posts.length > 0) {
    lines.push("");
    lines.push("## Posts");
    for (const p of topic.posts) {
      lines.push(`- ${p.title} (${p.id})`);
    }
  }
  return lines.join("\n");
}

export function formatTopicList(topics: SlabTopicSummary[]): string {
  if (topics.length === 0) return "No topics found.";
  const lines = ["# Topics", "", `Found ${topics.length} topic(s):`, ""];
  for (const t of topics) {
    const parent = t.parentId ? ` (parent: ${t.parentId})` : "";
    const priv = t.privacy ? ` [${t.privacy}]` : "";
    lines.push(`- ${t.name} — ${t.id}${parent}${priv}`);
  }
  return lines.join("\n");
}
```

### 7.5: Tool definitions

- [ ] **Step 7.5.1: Create `src/tools/topics.ts`**

```ts
import { Effect } from "effect";
import { TopicsService } from "../topics.ts";
import { formatTopicResponse, formatTopicList } from "../formatters.ts";
import type { ToolModule } from "./posts.ts";

export const getTopic: ToolModule = {
  definition: {
    name: "slab__get_topic",
    description:
      "Fetch a Slab topic by ID. Returns the topic's name, description, privacy, parent/ancestors/children, and the posts it contains.",
    inputSchema: {
      type: "object",
      properties: { topicId: { type: "string", description: "Slab topic ID." } },
      required: ["topicId"],
    },
  },
  handler: (args) =>
    Effect.gen(function* () {
      const topics = yield* TopicsService;
      const t = yield* topics.getTopic(args.topicId as string);
      return formatTopicResponse(t);
    }),
};

export const listTopics: ToolModule = {
  definition: {
    name: "slab__list_topics",
    description:
      "List all topics in your Slab organization. Returns a flat list with id, name, parent id, and privacy. Use this to resolve human-friendly topic names to ids before slab__create_post or slab__add_topic_to_post.",
    inputSchema: { type: "object", properties: {} },
  },
  handler: (_args) =>
    Effect.gen(function* () {
      const topics = yield* TopicsService;
      const list = yield* topics.listTopics();
      return formatTopicList(list);
    }),
};

export const createTopic: ToolModule = {
  definition: {
    name: "slab__create_topic",
    description: "Create a new Slab topic.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Topic name." },
        description: { type: "string", description: "Optional markdown description." },
        parentId: { type: "string", description: "Optional parent topic id." },
        memberEditable: {
          type: "string",
          enum: ["ALL", "POST", "NONE"],
          description: "Who can edit posts in this topic.",
        },
        privacy: {
          type: "string",
          enum: ["OPEN", "PRIVATE", "SECRET", "PUBLIC"],
          description: "Topic privacy.",
        },
        inheritParent: { type: "boolean", description: "Inherit owners/members from parent topic." },
      },
      required: ["name"],
    },
  },
  handler: (args) =>
    Effect.gen(function* () {
      const topics = yield* TopicsService;
      const t = yield* topics.createTopic({
        name: args.name as string,
        description: args.description as string | undefined,
        parentId: args.parentId as string | undefined,
        memberEditable: args.memberEditable as any,
        privacy: args.privacy as any,
        inheritParent: args.inheritParent as boolean | undefined,
      });
      return `Topic created: ${t.name} (${t.id})`;
    }),
};

export const updateTopic: ToolModule = {
  definition: {
    name: "slab__update_topic",
    description: "Update an existing Slab topic. Only fields you pass are sent.",
    inputSchema: {
      type: "object",
      properties: {
        topicId: { type: "string" },
        name: { type: "string" },
        description: { type: "string", description: "Markdown description." },
        parentId: { type: "string" },
        memberEditable: { type: "string", enum: ["ALL", "POST", "NONE"] },
        privacy: { type: "string", enum: ["OPEN", "PRIVATE", "SECRET", "PUBLIC"] },
        inheritParent: { type: "boolean" },
        propagatePrivacy: { type: "boolean", description: "If true, propagate privacy change to subtopics." },
        bannerUrl: { type: "string" },
      },
      required: ["topicId"],
    },
  },
  handler: (args) =>
    Effect.gen(function* () {
      const topics = yield* TopicsService;
      const t = yield* topics.updateTopic({
        topicId: args.topicId as string,
        name: args.name as string | undefined,
        description: args.description as string | undefined,
        parentId: args.parentId as string | undefined,
        memberEditable: args.memberEditable as any,
        privacy: args.privacy as any,
        inheritParent: args.inheritParent as boolean | undefined,
        propagatePrivacy: args.propagatePrivacy as boolean | undefined,
        bannerUrl: args.bannerUrl as string | undefined,
      });
      return `Topic updated: ${t.name} (${t.id})`;
    }),
};

export const deleteTopic: ToolModule = {
  definition: {
    name: "slab__delete_topic",
    description:
      "Delete a Slab topic. DESTRUCTIVE. Requires confirm: true. Posts inside the topic are NOT deleted; they become un-categorised.",
    inputSchema: {
      type: "object",
      properties: {
        topicId: { type: "string", description: "Topic ID to delete." },
        confirm: {
          type: "boolean",
          description: "Must be literally true; the call fails otherwise.",
        },
      },
      required: ["topicId", "confirm"],
    },
  },
  handler: (args) =>
    Effect.gen(function* () {
      const topics = yield* TopicsService;
      const t = yield* topics.deleteTopic(args.topicId as string, args.confirm === true);
      return `Topic deleted: ${t.name} (${t.id})`;
    }),
};

export const allTopicTools: ToolModule[] = [getTopic, listTopics, createTopic, updateTopic, deleteTopic];
```

### 7.6: Move search/list_posts into their own tool module

- [ ] **Step 7.6.1: Create `src/tools/search.ts`**

```ts
import { Effect } from "effect";
import { PostsService } from "../posts.ts";
import { formatSearchResults, formatListResults } from "../formatters.ts";
import type { ToolModule } from "./posts.ts";

export const search: ToolModule = {
  definition: {
    name: "slab__search",
    description: "Search for posts across your Slab workspace.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Search query string." } },
      required: ["query"],
    },
  },
  handler: (args) =>
    Effect.gen(function* () {
      const posts = yield* PostsService;
      const results = yield* posts.searchPosts(args.query as string);
      return formatSearchResults(results, args.query as string);
    }),
};

export const listPosts: ToolModule = {
  definition: {
    name: "slab__list_posts",
    description:
      "List posts in your Slab workspace, optionally filtered by topic. Returns each post with topic ids (no names). Resolve names via slab__list_topics.",
    inputSchema: {
      type: "object",
      properties: { topicId: { type: "string", description: "Optional topic ID to filter posts." } },
    },
  },
  handler: (args) =>
    Effect.gen(function* () {
      const posts = yield* PostsService;
      const results = yield* posts.listPosts(args.topicId as string | undefined);
      return formatListResults(results);
    }),
};

export const allSearchTools: ToolModule[] = [search, listPosts];
```

### 7.7: Wire everything into `src/index.ts`

- [ ] **Step 7.7.1: Replace the registration logic in `src/index.ts`**

Imports:

```ts
import { TopicsService, TopicsServiceLive } from "./topics.ts";
import { allPostEditTools, allPostReadTools, allPostMutationTools } from "./tools/posts.ts";
import { allTopicTools } from "./tools/topics.ts";
import { allSearchTools } from "./tools/search.ts";
```

Replace the layer wiring:

```ts
const SlabClientLayer = SlabClientServiceLive.pipe(Layer.provide(ConfigServiceLive));

const AppLayer = Layer.mergeAll(
  ConfigServiceLive,
  SlabClientLayer,
  PostsServiceLive.pipe(Layer.provide(SlabClientLayer)),
  TopicsServiceLive.pipe(Layer.provide(SlabClientLayer)),
);
```

Replace `toolHandlers` and the tool list:

```ts
const allTools = [
  ...allPostReadTools,
  ...allPostEditTools,
  ...allPostMutationTools,
  ...allTopicTools,
  ...allSearchTools,
];

const toolHandlers: Record<string, (args: any) => Effect.Effect<string, any>> = Object.fromEntries(
  allTools.map((t) => [t.definition.name, t.handler]),
);
```

In the server handler:

```ts
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools.map((t) => t.definition),
  }));
```

### 7.8: Tests

- [ ] **Step 7.8.1: Create `test/topics.test.ts`**

```ts
import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import { Effect, Layer, Context } from "effect";
import type { SlabClientService } from "../src/client.ts";
import { SlabClientServiceLive } from "../src/client.ts";
import type { TopicsService } from "../src/topics.ts";
import { TopicsServiceLive } from "../src/topics.ts";
import type { ConfigService } from "../src/config.ts";

const mockFetch = mock();

const TestConfigLayer = Layer.succeed(
  Context.GenericTag<ConfigService>("@services/ConfigService"),
  {
    config: {
      apiToken: "test-token",
      team: "test",
      graphqlUrl: "https://api.slab.com/v1/graphql",
    },
  },
);

describe("TopicsService", () => {
  const originalFetch = global.fetch;
  let topics: TopicsService;

  beforeEach(async () => {
    global.fetch = mockFetch as any;
    const SlabClientLayer = SlabClientServiceLive.pipe(Layer.provide(TestConfigLayer));
    const program = Effect.gen(function* () {
      return yield* Context.GenericTag<TopicsService>("@services/TopicsService");
    });
    topics = await Effect.runPromise(
      program.pipe(Effect.provide(TopicsServiceLive.pipe(Layer.provide(SlabClientLayer)))),
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    mockFetch.mockClear();
  });

  describe("getTopic", () => {
    test("renders description as markdown and lists posts/parent/children", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            topic: {
              id: "t1",
              name: "Eng",
              description: [{ insert: "Engineering team docs.\n" }],
              privacy: "OPEN",
              memberEditable: "ALL",
              inheritParent: false,
              parent: { id: "root", name: "Root" },
              ancestors: [{ id: "root", name: "Root" }],
              children: [{ id: "t2", name: "Backend" }],
              posts: [{ id: "p1", title: "RFC 1", publishedAt: "2024-01-01T00:00:00Z" }],
              hierarchy: ["root", "t1"],
            },
          },
        }),
      });

      const t = await Effect.runPromise(topics.getTopic("t1"));
      expect(t.name).toBe("Eng");
      expect(t.description).toBe("Engineering team docs.");
      expect(t.parent).toEqual({ id: "root", name: "Root" });
      expect(t.children).toEqual([{ id: "t2", name: "Backend" }]);
      expect(t.posts).toHaveLength(1);
    });
  });

  describe("listTopics", () => {
    test("flattens organization.topics with parent id only", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            organization: {
              id: "o1",
              topics: [
                { id: "t1", name: "Eng", parent: { id: "root" }, privacy: "OPEN" },
                { id: "t2", name: "Design", parent: null, privacy: "PRIVATE" },
              ],
            },
          },
        }),
      });

      const list = await Effect.runPromise(topics.listTopics());
      expect(list).toEqual([
        { id: "t1", name: "Eng", parentId: "root", privacy: "OPEN" },
        { id: "t2", name: "Design", parentId: undefined, privacy: "PRIVATE" },
      ]);
    });
  });

  describe("createTopic", () => {
    test("converts description markdown to Delta and passes other fields", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: { createTopic: { id: "t9", name: "New" } } }),
      });

      const t = await Effect.runPromise(topics.createTopic({
        name: "New",
        description: "**hi**",
        parentId: "p",
        privacy: "OPEN",
      }));
      expect(t).toEqual({ id: "t9", name: "New" });
      const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body);
      expect(body.variables.name).toBe("New");
      expect(body.variables.parentId).toBe("p");
      expect(body.variables.privacy).toBe("OPEN");
      expect(body.variables.description.ops).toEqual([
        { insert: "hi", attributes: { bold: true } },
        { insert: "\n" },
      ]);
    });
  });

  describe("deleteTopic", () => {
    test("rejects when confirm is not true", async () => {
      const result = await Effect.runPromise(topics.deleteTopic("t1", false).pipe(Effect.either));
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("DeleteTopicConfirmError");
      }
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("calls deleteTopic when confirmed", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: { deleteTopic: { id: "t1", name: "Old" } } }),
      });
      const t = await Effect.runPromise(topics.deleteTopic("t1", true));
      expect(t).toEqual({ id: "t1", name: "Old" });
    });
  });
});
```

- [ ] **Step 7.8.2: Run tests**

```bash
bun test
```

Expected: all tests pass — previous + the topic tests.

- [ ] **Step 7.8.3: Smoke-run the server**

```bash
SLAB_API_TOKEN=dummy SLAB_TEAM=dummy timeout 2s bun run src/index.ts < /dev/null
```

Expected: starts without exception.

- [ ] **Step 7.8.4: Commit**

```bash
git add src/graphql.ts src/types.ts src/topics.ts src/formatters.ts src/tools/ src/index.ts test/topics.test.ts
git commit -m "feat(topics): TopicsService + tools (get/list/create/update/delete with confirm gate)"
```

---

## Task 8: Extended reads (surface dropped post fields)

**Spec reference:** §6 reads (post field expansion).

**Files:**
- Modify: `src/types.ts` (extend `SlabPost`)
- Modify: `src/posts.ts` (extend `transformPost`)
- Modify: `src/formatters.ts` (render new fields)
- Modify: `test/posts.test.ts` (cover new fields)
- (No GraphQL change needed — `GET_POST_QUERY` already requests these.)

- [ ] **Step 8.1: Extend `SlabPost` in `src/types.ts`**

Replace the `SlabPost` interface:

```ts
export interface SlabPostTopic {
  id: string;
  // SlimTopic has no name on this path; name available via list_topics.
}

export interface SlabPost {
  id: string;
  title: string;
  content: string;
  url: string;
  created_at: string;
  updated_at: string;
  created_by?: SlabUser;
  updated_by?: SlabUser;

  // Newly surfaced fields:
  version?: number;
  publishedAt?: string;
  archivedAt?: string;
  linkAccess?: PostLinkAccess;
  topics?: SlabPostTopic[];
}
```

- [ ] **Step 8.2: Update `transformPost` in `src/posts.ts`**

Inside `transformPost`, change the returned object:

```ts
    return {
      id: post.id,
      title: post.title,
      content: contentText,
      url: post.url || `https://slab.com/posts/${post.id}`,
      created_at: post.insertedAt,
      updated_at: post.updatedAt,
      created_by: post.owner
        ? { id: post.owner.id, display_name: post.owner.name, email: post.owner.email }
        : undefined,
      version: typeof post.version === "number" ? post.version : undefined,
      publishedAt: post.publishedAt ?? undefined,
      archivedAt: post.archivedAt ?? undefined,
      linkAccess: post.linkAccess ?? undefined,
      topics: Array.isArray(post.topics)
        ? post.topics.map((t: any) => ({ id: t.id }))
        : undefined,
    };
```

- [ ] **Step 8.3: Update `formatPostResponse`**

Replace `formatPostResponse` in `src/formatters.ts`:

```ts
export function formatPostResponse(post: SlabPost): string {
  const title = post.title || "Untitled";
  const content = post.content || "";
  const author = post.created_by?.display_name || "Unknown";
  const updatedAt = post.updated_at ? new Date(post.updated_at).toLocaleString() : "Unknown";
  const url = post.url || "";

  const meta: string[] = [];
  meta.push(`**Author:** ${author}`);
  meta.push(`**Last Updated:** ${updatedAt}`);
  meta.push(`**URL:** ${url}`);
  if (typeof post.version === "number") meta.push(`**Version:** ${post.version}`);
  if (post.publishedAt) meta.push(`**Published:** ${new Date(post.publishedAt).toLocaleString()}`);
  if (post.archivedAt) meta.push(`**Archived:** ${new Date(post.archivedAt).toLocaleString()}`);
  if (post.linkAccess) meta.push(`**Link Access:** ${post.linkAccess}`);
  if (post.topics && post.topics.length > 0) {
    meta.push(`**Topic IDs:** ${post.topics.map((t) => t.id).join(", ")}`);
  }

  return `# ${title}

${meta.join("\n")}

---

${content}`;
}
```

- [ ] **Step 8.4: Add a test**

In `test/posts.test.ts`, append:

```ts
  describe("getPost extended fields", () => {
    test("surfaces version, publishedAt, archivedAt, linkAccess, topics", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            post: {
              id: "p1",
              title: "T",
              content: [{ insert: "Body" }, { insert: "\n" }],
              insertedAt: "2024-01-01T00:00:00Z",
              updatedAt: "2024-01-02T00:00:00Z",
              publishedAt: "2024-01-01T01:00:00Z",
              archivedAt: null,
              version: 7,
              linkAccess: "INTERNAL",
              topics: [{ id: "t1" }, { id: "t2" }],
            },
          },
        }),
      });

      const p = await Effect.runPromise(posts.getPost("p1"));
      expect(p.version).toBe(7);
      expect(p.publishedAt).toBe("2024-01-01T01:00:00Z");
      expect(p.archivedAt).toBeUndefined();
      expect(p.linkAccess).toBe("INTERNAL");
      expect(p.topics).toEqual([{ id: "t1" }, { id: "t2" }]);
    });
  });
```

- [ ] **Step 8.5: Update `GET_TOPIC_POSTS_QUERY` and `GET_ORGANIZATION_POSTS_QUERY` to surface topic ids on list paths**

In `src/graphql.ts`, modify `GET_ORGANIZATION_POSTS_QUERY` (already has `topics { id }` — verify). Modify `GET_TOPIC_POSTS_QUERY` to also include `topics { id }` on each post:

```ts
export const GET_TOPIC_POSTS_QUERY = `
  query GetTopicPosts($topicId: ID!) {
    topic(id: $topicId) {
      id
      name
      posts {
        id
        title
        content
        insertedAt
        publishedAt
        linkAccess
        topics { id }
        owner {
          id
          name
          email
        }
      }
    }
  }
`;
```

- [ ] **Step 8.6: Run tests**

```bash
bun test
```

Expected: all pass.

- [ ] **Step 8.7: Commit**

```bash
git add src/types.ts src/posts.ts src/formatters.ts src/graphql.ts test/posts.test.ts
git commit -m "feat(reads): surface version/publishedAt/archivedAt/linkAccess/topics on posts"
```

---

## Task 9: Integration tests (gated)

**Spec reference:** §8 integration tests.

**Files:**
- Create: `test/integration/edit-roundtrip.test.ts`
- Create: `test/integration/topics.test.ts`
- Create: `test/integration/_helpers.ts` (shared bootstrap)
- Modify: `.env.example` (document new vars; create if missing)

These tests run only if both `SLAB_API_TOKEN` and `SLAB_TEST_TOPIC` are present. Without those, every test in the file skips. The topic referenced by `SLAB_TEST_TOPIC` should be the `MCP-Testing` topic the user has configured.

- [ ] **Step 9.1: Create `test/integration/_helpers.ts`**

```ts
import { Effect, Layer } from "effect";
import { ConfigServiceLive } from "../../src/config.ts";
import { SlabClientServiceLive } from "../../src/client.ts";
import { PostsService, PostsServiceLive } from "../../src/posts.ts";
import { TopicsService, TopicsServiceLive } from "../../src/topics.ts";

const SlabClientLayer = SlabClientServiceLive.pipe(Layer.provide(ConfigServiceLive));
const IntegrationLayer = Layer.mergeAll(
  ConfigServiceLive,
  SlabClientLayer,
  PostsServiceLive.pipe(Layer.provide(SlabClientLayer)),
  TopicsServiceLive.pipe(Layer.provide(SlabClientLayer)),
);

export const isIntegrationEnabled = (): boolean =>
  Boolean(process.env.SLAB_API_TOKEN && process.env.SLAB_TEAM && process.env.SLAB_TEST_TOPIC);

export const runWithServices = <A, E>(
  program: Effect.Effect<A, E, PostsService | TopicsService>,
): Promise<A> => Effect.runPromise(program.pipe(Effect.provide(IntegrationLayer)));
```

- [ ] **Step 9.2: Create `test/integration/edit-roundtrip.test.ts`**

```ts
import { test, expect, describe } from "bun:test";
import { Effect } from "effect";
import { PostsService } from "../../src/posts.ts";
import { isIntegrationEnabled, runWithServices } from "./_helpers.ts";

const skipIfDisabled = (name: string, body: () => Promise<void>) =>
  isIntegrationEnabled() ? test(name, body) : test.skip(name, body);

describe("edit roundtrip (integration)", () => {
  skipIfDisabled("create → get → edit_post → append → replace_section → update_post → archive", async () => {
    const topicId = process.env.SLAB_TEST_TOPIC!;
    const ts = Date.now();
    const fixtureMd = `# Section A\n\nbefore edit.\n\n# Section B\n\nbody B.`;

    const created = await runWithServices(
      Effect.gen(function* () {
        const posts = yield* PostsService;
        return yield* posts.createPost({ title: `slabby-it-${ts}`, topicId, content: fixtureMd });
      }),
    );
    expect(created.id).toBeTruthy();

    const fetched = await runWithServices(
      Effect.gen(function* () {
        const posts = yield* PostsService;
        return yield* posts.getPost(created.id);
      }),
    );
    expect(fetched.content).toContain("Section A");
    expect(fetched.content).toContain("before edit.");

    const edited = await runWithServices(
      Effect.gen(function* () {
        const posts = yield* PostsService;
        return yield* posts.editPost(created.id, "before edit.", "after edit.");
      }),
    );
    expect(edited.content).toContain("after edit.");
    expect(edited.content).not.toContain("before edit.");
    expect(edited.content).toContain("Section B"); // untouched

    const appended = await runWithServices(
      Effect.gen(function* () {
        const posts = yield* PostsService;
        return yield* posts.appendToPost(created.id, "Trailing paragraph.");
      }),
    );
    expect(appended.content.endsWith("Trailing paragraph.")).toBe(true);

    const sectioned = await runWithServices(
      Effect.gen(function* () {
        const posts = yield* PostsService;
        return yield* posts.replaceSection(created.id, "Section B", "new body B.");
      }),
    );
    expect(sectioned.content).toContain("new body B.");
    expect(sectioned.content).not.toContain("body B.");

    const replaced = await runWithServices(
      Effect.gen(function* () {
        const posts = yield* PostsService;
        return yield* posts.fullReplacePost(created.id, "# Replaced\n\nFresh.");
      }),
    );
    expect(replaced.content).toBe("# Replaced\n\nFresh.");

    // cleanup
    await runWithServices(
      Effect.gen(function* () {
        const posts = yield* PostsService;
        return yield* posts.setPostState({ postId: created.id, archived: true });
      }),
    );
  }, 30_000);
});
```

- [ ] **Step 9.3: Create `test/integration/topics.test.ts`**

```ts
import { test, expect, describe } from "bun:test";
import { Effect } from "effect";
import { TopicsService } from "../../src/topics.ts";
import { isIntegrationEnabled, runWithServices } from "./_helpers.ts";

const skipIfDisabled = (name: string, body: () => Promise<void>) =>
  isIntegrationEnabled() ? test(name, body) : test.skip(name, body);

describe("topics (integration)", () => {
  skipIfDisabled("list_topics returns at least the SLAB_TEST_TOPIC and get_topic resolves it", async () => {
    const topicId = process.env.SLAB_TEST_TOPIC!;

    const list = await runWithServices(
      Effect.gen(function* () {
        const topics = yield* TopicsService;
        return yield* topics.listTopics();
      }),
    );
    const match = list.find((t) => t.id === topicId);
    expect(match).toBeTruthy();

    const details = await runWithServices(
      Effect.gen(function* () {
        const topics = yield* TopicsService;
        return yield* topics.getTopic(topicId);
      }),
    );
    expect(details.id).toBe(topicId);
    expect(typeof details.name).toBe("string");
  }, 15_000);
});
```

- [ ] **Step 9.4: Document env vars in `.env.example`**

Create or update `.env.example` at the repo root:

```bash
# Required: Slab API token (https://your-team.slab.com → Settings → API)
SLAB_API_TOKEN=

# Required: Slab team subdomain (e.g. "acme" for acme.slab.com)
SLAB_TEAM=

# Optional: enable integration tests (test/integration/) by setting this to
# the ID of the topic where integration tests can create scratch posts.
# The user maintains a topic named "MCP-Testing" for this purpose.
SLAB_TEST_TOPIC=
```

- [ ] **Step 9.5: Run unit tests; verify integration tests skip cleanly**

```bash
bun test
```

Expected: all unit tests pass; integration tests show as skipped (`SLAB_TEST_TOPIC` not set in the bare run).

- [ ] **Step 9.6: (Optional) Run integration tests with credentials**

If you have credentials available:

```bash
export SLAB_API_TOKEN=...
export SLAB_TEAM=...
export SLAB_TEST_TOPIC=...
bun test test/integration/
```

Expected: both integration tests pass against the real API. A scratch post is created in the MCP-Testing topic and archived at the end. If you see assertion failures on content (e.g. `formatPostResponse` adds extra metadata), refine the assertions to match the actual content shape; do not loosen them past the intent of each step.

- [ ] **Step 9.7: Commit**

```bash
git add test/integration/ .env.example
git commit -m "test(integration): edit roundtrip + topics tests, gated on SLAB_TEST_TOPIC"
```

---

## Task 10: README + tool description polish

**Spec reference:** §9 migration notes (README updates).

**Files:**
- Modify: `README.md` (new tool list, edit-vs-update guidance, integration env vars)
- Modify: `SCHEMA_VERIFICATION.md` (mark which mutations are now exposed)

- [ ] **Step 10.1: Update `README.md` features list**

Replace the existing "Features" section with:

```markdown
## Features

- 📖 **Read** Slab posts by ID or URL (now with version, publishedAt, archivedAt, linkAccess, topics).
- ✏️ **Surgical editing** via Quill Delta:
  - `slab__edit_post` — find-and-replace on a unique substring (preferred for targeted edits).
  - `slab__append_to_post` — append markdown to the end of a post.
  - `slab__replace_section` — replace the body under a uniquely-named heading.
  - `slab__update_post` — full-document rewrite via a minimal Delta diff (for total rewrites).
- 🏗️ **Post lifecycle:** `slab__create_post`, `slab__set_post_state` (archive/publish/owner/linkAccess/banner), `slab__sync_post` (mirror external sources).
- 🏷️ **Topics:** `slab__get_topic`, `slab__list_topics`, `slab__create_topic`, `slab__update_topic`, `slab__delete_topic` (destructive — requires `confirm: true`), `slab__add_topic_to_post`, `slab__remove_topic_from_post`.
- 🔍 **Search and listing:** `slab__search`, `slab__list_posts`.
- 🔐 Personal Slab API token, never sent to Anthropic's servers.
```

- [ ] **Step 10.2: Add an "Editing model" section to `README.md`**

After "How It Works", insert:

```markdown
## Editing model

Slab stores post content in Quill Delta format. Slabby converts between Delta and Markdown so agents can read and write markdown, while the actual mutations sent to Slab are minimal Delta patches.

**Prefer `slab__edit_post`** for any partial change. It locates a unique substring and emits a tight `retain / delete / insert` patch that preserves all surrounding formatting and keeps the version history clean. `oldText` must be unique in the post and contained within a single formatting run (e.g. all-plain, all-bold, all-link); spans crossing formatting boundaries are rejected.

**`slab__update_post` is for full rewrites only.** It computes a minimal diff via the `quill-delta` library, but constructs not expressible in markdown (tables, custom embed attributes) are lost on a full update.

**`slab__sync_post`** creates or updates a read-only post mirroring an external source. Slab users cannot edit a synced post in-place.

`slab__delete_topic` is destructive and requires `confirm: true`. There is no `delete_post` — archive a post via `slab__set_post_state({archived: true})` instead.
```

- [ ] **Step 10.3: Add an "Integration tests" section**

Insert under "Development":

```markdown
### Integration tests

`test/integration/` contains tests that hit the real Slab API. They are skipped unless **all three** of these env vars are set:

- `SLAB_API_TOKEN` — your API token.
- `SLAB_TEAM` — your Slab subdomain.
- `SLAB_TEST_TOPIC` — the ID of a topic used as a scratch space (the project maintains a topic named `MCP-Testing` for this purpose). Each run creates a fresh post in that topic and archives it at the end.

```bash
SLAB_API_TOKEN=... SLAB_TEAM=... SLAB_TEST_TOPIC=... bun test test/integration/
```
```

- [ ] **Step 10.4: Update `SCHEMA_VERIFICATION.md`**

Open the file. Find any tables or sections listing exposed operations. Update to reflect the new tool set documented in the README "Features" section. Leave the schema-correctness notes untouched.

- [ ] **Step 10.5: Run tests one more time**

```bash
bun test
```

Expected: everything green.

- [ ] **Step 10.6: Commit**

```bash
git add README.md SCHEMA_VERIFICATION.md
git commit -m "docs: update README + SCHEMA_VERIFICATION for editing engine and new tools"
```

---

## Task 11: Open PR back to upstream (russwyte/slabby)

- [ ] **Step 11.1: Push final state**

```bash
git push origin feat/editing-engine
```

- [ ] **Step 11.2: Open PR via gh**

```bash
gh pr create \
  --repo russwyte/slabby \
  --base main \
  --head LordSpecial:feat/editing-engine \
  --title "feat: Quill Delta editing engine + expanded mutation coverage" \
  --body "$(cat <<'EOF'
## Summary

- Replaces the destructive `update_post` (which deleted all formatting on every call) with a Quill Delta editing engine: `edit_post` (find-and-replace), `append_to_post`, `replace_section`, plus a Delta-diffed `update_post` for full rewrites.
- Adds expanded Slab GraphQL mutation coverage: `create_post`, `set_post_state`, `sync_post`, all topic mutations (`get_topic`, `list_topics`, `create_topic`, `update_topic`, `delete_topic` with `confirm: true` gate), and `add_topic_to_post` / `remove_topic_from_post`.
- Surfaces previously dropped Post fields on `get_post`: `version`, `publishedAt`, `archivedAt`, `linkAccess`, `topics`.
- Out of scope (deferred): `delete_post`, search pagination, users/groups/comments, webhooks, full-org export.

Design spec: `docs/superpowers/specs/2026-06-03-slabby-editing-and-mutations-design.md`.

## Test plan

- [ ] `bun test` — all unit tests pass.
- [ ] Integration tests run against a workspace by setting `SLAB_API_TOKEN`, `SLAB_TEAM`, `SLAB_TEST_TOPIC`.
- [ ] Manual smoke: launch via `bun run src/index.ts`, exercise `edit_post`, `append_to_post`, `replace_section` from an MCP client.
EOF
)"
```

- [ ] **Step 11.3: Report the PR URL**

The `gh pr create` command prints the PR URL. Surface it in the final status message so the user can review.

---

## Self-review checklist (run by the implementing engineer before declaring done)

- [ ] `bun test` — every unit test passes.
- [ ] Integration tests skip cleanly when env vars are absent; pass when set.
- [ ] The MCP server starts via `SLAB_API_TOKEN=dummy SLAB_TEAM=dummy bun run src/index.ts < /dev/null` without exception.
- [ ] The tool list in `ListToolsRequestSchema` is the union of `allPostReadTools + allPostEditTools + allPostMutationTools + allTopicTools + allSearchTools` and matches the README features list.
- [ ] No file references `src/deltaToMarkdown.ts` (the old path).
- [ ] `src/client.ts` contains only the transport + the two transport-specific tagged errors.
- [ ] No `TODO` or `FIXME` strings added in this branch (run `git diff main..HEAD | grep -E '^\+.*\b(TODO|FIXME)\b'` — expect empty).
- [ ] PR body matches the test plan above; the PR points to the spec.
