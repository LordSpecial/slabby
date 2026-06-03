# Slabby: Editing Engine + Expanded Mutation Coverage — Design

**Status:** Draft (pending user review)
**Date:** 2026-06-03
**Scope:** Replace whole-document content overwrite with a real Quill Delta editing engine; add expanded Slab mutation coverage — every post and topic mutation in the schema **except** `deletePost` (create posts, sync external posts, manage topics, change post state, attach/detach topics); expose dropped read fields needed to support those mutations.

---

## 1. Problem

Slabby today wraps four Slab GraphQL operations: `post`, `updatePostContent`, `search`, and `topic`/`organization.posts`. Two fundamental gaps:

1. **Editing is destructive.** `createReplacementDelta` in `src/client.ts:145` issues `{delete: <full length>, insert: <new plain text>}`. Every update wipes all formatting (headings, lists, links, code blocks, bold/italic, images, embeds) and bloats version history with one all-text revision per call. Note: even after this work, full-document update can only preserve formatting the markdown-to-Delta layer is able to represent (see lossy edges in §4, Layer A). Constructs outside markdown's expressive range (e.g. tables, embeds with custom attributes) are still lossy on a full-document round trip; the targeted `edit_post` / `append_to_post` / `replace_section` paths avoid that problem because they leave untouched regions untouched.
2. **Schema coverage is narrow.** Slab exposes mutations slabby never wraps: `createPost`, `deletePost`, `syncPost`, `updatePost` (state/owner/link-access/banner), `createTopic`, `updateTopic`, `deleteTopic`, `addTopicToPost`, `removeTopicFromPost`. Of these, `deletePost` is intentionally excluded from this design (see §2 non-goals — archive via `set_post_state` instead); the rest are all in scope. Topic and full-post-field reads are also absent, so agents can't discover topic ids or read `version`/`publishedAt`/`linkAccess`/`topics` on a post.

Primary goal: make slabby's editing operations behave the way an MCP-driven agent actually wants — surgical, predictable, and preserving markdown-expressible formatting on the regions touched. (Targeted edits leave untouched regions byte-identical; full-document update preserves only what markdown-to-Delta can express.) Secondary goal: round out mutation/read coverage so the same agent can create, organise, and manage content end to end.

## 2. Goals & non-goals

**Goals**
- Targeted editing operations (`edit_post`, `append_to_post`, `replace_section`) emit minimal Delta patches and leave untouched regions byte-identical, preserving their existing formatting. Full-document update emits a minimal diff via `quill-delta.diff` and preserves whatever formatting markdown-to-Delta can express.
- Provide an `edit_post` tool with the same find-and-replace ergonomics as Claude Code's built-in `Edit`.
- Add tools for: append to post, replace section under a heading, full-document update (now less destructive — replaces the nuke-and-paste with a minimal Delta diff; preserves markdown-expressible formatting and untouched-region attributes).
- Wrap mutations: `createPost`, `syncPost`, `updatePost` (state), `createTopic`, `updateTopic`, `deleteTopic`, `addTopicToPost`, `removeTopicFromPost`.
- Add reads: `get_topic`, `list_topics`. Surface dropped Post fields (`version`, `publishedAt`, `archivedAt`, `linkAccess`, `topics`).
- Split current files so no single file owns more than one domain.

**Non-goals (deferred to follow-up specs)**
- `delete_post` (explicitly removed at user's request — archive via `set_post_state` instead).
- Search pagination / cursors / non-post search result types.
- Batch `posts(ids)` / `topics(ids)`.
- Users, Groups, Comments queries.
- `exportAll` (long-running, distinct lifecycle).
- Webhooks / event subscriptions (not in GraphQL schema; would need separate HTTP server).

## 3. Architecture

### File layout

```
src/
  client.ts             — GraphQL transport only (makeGraphQLRequest, error tags, ConfigService wiring)
  index.ts              — MCP server entry, tool registry assembly
  config.ts             — unchanged
  utils.ts              — unchanged (postId extraction)
  formatters.ts         — extended (formatTopicResponse, full post fields)
  types.ts              — extended (SlabTopic, SlabPostState, full SlabPost)
  graphql.ts            — extended (all new queries/mutations as string consts)
  posts.ts              — PostsService: get/edit/append/replace_section/update/create/sync/set_state
  topics.ts             — TopicsService: get/list/create/update/delete/add_to_post/remove_from_post
  tools/
    posts.ts            — MCP tool definitions for post tools
    topics.ts           — MCP tool definitions for topic tools
    search.ts           — existing search + list_posts tools moved here
  delta/
    markdown-to-delta.ts  — markdown → Quill Delta ops
    delta-to-markdown.ts  — relocated from src/deltaToMarkdown.ts
    edits.ts              — pure edit-Delta builders
```

`src/client.ts` keeps only the transport (`makeGraphQLRequest`, `SlabApiError`, `SlabNetworkError`). Domain logic moves to `posts.ts` and `topics.ts`. `index.ts` becomes thin: imports tool registries, merges them, registers with the MCP server.

### Service composition

Two new Effect services in addition to existing `SlabClientService`:

```
PostsService    requires SlabClientService
TopicsService   requires SlabClientService

const SlabClientLayer = SlabClientServiceLive.pipe(
  Layer.provide(ConfigServiceLive),
)

AppLayer = Layer.mergeAll(
  ConfigServiceLive,
  SlabClientLayer,
  PostsServiceLive.pipe(Layer.provide(SlabClientLayer)),
  TopicsServiceLive.pipe(Layer.provide(SlabClientLayer)),
)
```

Defining `SlabClientLayer` once avoids re-providing `ConfigServiceLive` to each consumer and keeps `PostsServiceLive` / `TopicsServiceLive` requirement sets to `SlabClientService` alone.

Each tool module exports `{ definition, handler }`. `index.ts` collects them into one list. Adding a tool is a one-file change.

### Dependencies added

- `quill-delta` (^5.x) — official `Delta` class with `.compose()`, `.diff()`, `.transform()`. Provides the diff engine used by full-document update.
- `marked` (^14.x) — markdown lexer/walker for the markdown-to-delta path. Sync, no DOM, small. (`unified`/`remark` is the alternative; rejected as heavier and async-only without need.)

## 4. Editing engine

Three layers. Layers A and B are pure; Layer C is the MCP surface.

### Layer A — Markdown ↔ Delta (both directions)

- `src/delta/delta-to-markdown.ts` — existing implementation, relocated unchanged. Delta → HTML (`quill-delta-to-html`) → Markdown (`turndown`).
- `src/delta/markdown-to-delta.ts` — new. Markdown → AST (`marked.lexer`) → walker emitting `quill-delta` ops with formatting attributes:
  - Headings 1–6 → `\n` with `{header: N}` attribute on the newline.
  - Bold / italic / strike / inline code → `{bold|italic|strike|code: true}` on the insert.
  - Links → `{link: url}` on the inserted text.
  - Images → `{insert: {image: url}}` embed.
  - Fenced code blocks → block of inserts followed by `\n` with `{"code-block": lang|"plain"}`.
  - Ordered / unordered / nested lists → newlines with `{list: "ordered"|"bullet", indent: N}`.
  - Blockquotes → newlines with `{blockquote: true}`.
  - Paragraphs → plain inserts terminated by `\n`.
  - Hard breaks (`  \n`) → plain `\n` insert.

Lossy edges acceptable for v1: tables, footnotes, raw HTML inline. Documented in module doc-string. Add a test marker so future expansion is discoverable.

### Layer B — Edit-Delta builders (`src/delta/edits.ts`, pure)

All functions return a Quill Delta `{ops: [...]}` patch. Throw `DeltaEditError` on bad input.

- `buildFindReplaceDelta(currentDelta, oldText, newText)` —
  Flatten `currentDelta` to plain text (insert strings concatenated; embeds counted as one character with `￼`-style placeholder). Count `indexOf(oldText)` matches.
  - 0 matches → `DeltaEditError({kind: "not_found", message: "oldText not found"})`.
  - 2+ matches → `DeltaEditError({kind: "ambiguous", message: "oldText matched N times; add surrounding context to disambiguate"})`.
  - 1 match → determine the matched span in op-space. Walk Delta ops projecting each character to its op's `attributes` (or `undefined`). Collect the set of attribute fingerprints across the matched span:
    - **If the span lies entirely within a single op (one attribute fingerprint)** → emit `[retain matchStart, delete oldText.length, insert newText, attributes: <attrs of that op>]`. Inheriting attributes prevents stripping formatting when editing inside, e.g., a bold paragraph.
    - **If the span crosses multiple ops with differing attributes** → throw `DeltaEditError({kind: "mixed_attributes", message: "oldText spans formatting boundaries; pick text inside a single formatted run, or use replace_section / update_post for cross-format edits"})`. v1 explicitly rejects this case. Future versions may relax by per-character composition.
    - **If the span crosses multiple ops with identical attributes** (e.g. neighbouring plain-text ops produced by markdown-to-delta segmentation) → treat as the single-op case.
- `buildAppendDelta(currentDelta, newMarkdown)` —
  Convert `newMarkdown` via Layer A. Compute `currentLength`. Inspect the tail of the current Delta's plain-text projection to count trailing `\n` characters (call it `tailNewlines`). Emit `[retain currentLength, insert <separator + newOps>]`, where `separator = "\n".repeat(max(0, 2 - tailNewlines))`. This guarantees **at least two** newlines separate existing content from appended content. The existing tail is not modified — if the document already ends with three or more newlines, those remain; we never `delete` from the tail. (We don't aggressively trim because the tail's existing structure may carry block attributes meaningful to Slab's renderer.) Earlier draft incorrectly described this as "trim trailing `\n`"; in Delta semantics `retain` preserves and cannot trim.
- `buildSectionReplaceDelta(currentDelta, headingText, newSectionMarkdown)` —
  Line-based detection, not op-equality. Stream the current Delta's ops accumulating into "logical lines": each `\n` insert (whether on its own or embedded in a longer string) closes the current line and applies that newline's block attributes to it. For every line, record `{startIndex, endIndex, blockAttrs, plainText}` where `plainText` is the concatenation of all string-insert content on the line with surrounding whitespace stripped. A line is a "heading line" iff its newline carries `{header: N}` for some `N` in 1–6. Find the heading line whose stripped `plainText` equals `headingText`.
  - 0 matches → `DeltaEditError({kind: "not_found", message: "heading 'X' not found"})`.
  - 2+ matches → `DeltaEditError({kind: "ambiguous", message: "heading 'X' matched N times; section replace requires a unique heading"})`.
  - 1 match at level `N` → span to replace runs from the position immediately **after** the heading's trailing `\n` to the position immediately **before** the next heading line of level `M <= N` (or to end-of-doc if no such line). Replace span with Layer A output of `newSectionMarkdown`. The heading line itself is preserved.

  This treatment is robust to: (a) heading text split across multiple ops because of inline formatting, (b) heading text and the newline appearing in the same op or different ops, (c) blank lines and other intra-section formatting.
- `buildFullReplaceDelta(currentDelta, newMarkdown)` —
  Build `newDelta` via Layer A, then `currentDeltaInstance.diff(newDeltaInstance)`. Returns the minimal `retain/delete/insert` set. Replaces the current "delete all, insert plain text" nuke. Preserves version history granularity.

### Layer C — MCP tools (`src/tools/posts.ts`)

| Tool | Args | Behaviour |
| --- | --- | --- |
| `slab__edit_post` | `{postId, oldText, newText}` | Layer B `findReplace`. **Primary edit tool.** Steering description tells agents to prefer this for partial changes. |
| `slab__append_to_post` | `{postId, content}` | Layer B `append`. |
| `slab__replace_section` | `{postId, heading, content}` | Layer B `sectionReplace`. |
| `slab__update_post` | `{postId, content}` | Layer B `fullReplaceDiff`. Description: "Full-document rewrite. Use only for total replacement; prefer `edit_post` for partial changes. Constructs not expressible in markdown (e.g. tables, certain embed attributes) may be lost on a full update — use the targeted edit tools to avoid touching those regions." |

All four call `updatePostContent` with the resulting Delta and run through the existing `transformPost` for the response payload.

## 5. Mutation coverage

New tools (`src/tools/posts.ts`, `src/tools/topics.ts`):

| Tool | Args | Schema mutation | Notes |
| --- | --- | --- | --- |
| `slab__create_post` | `{title, topicId?, content?, templateId?}` | `createPost` → optional follow-up `updatePostContent` | Returns new post with `id` and `url`. `templateId` and `content` are **mutually exclusive in v1** — passing both throws `SlabApiError("create_post: pass templateId OR content, not both. Use templateId for a templated post and edit_post afterward to add content; use content for a blank post seeded with content.")`. If `content` provided alone, the second call (`updatePostContent`) patches the empty body using Layer A (markdown → Delta) — since the new post body is empty, an insert-only Delta is the correct shape. If `templateId` provided alone, no follow-up call; agent edits via `edit_post` / `replace_section` afterward. Tested explicitly: see §8 unit tests `posts.test.ts`. |
| `slab__sync_post` | `{externalId, content, format: "HTML"|"MARKDOWN", editUrl, readUrl?}` | `syncPost` | Description explicitly flags: creates/updates a **readonly mirror** in Slab. Native format pass-through; no Delta conversion. |
| `slab__set_post_state` | `{postId, archived?, published?, linkAccess?, ownerId?, bannerUrl?}` | `updatePost` (not `updatePostContent`) | Optional fields; serialises only those provided. Also serves as the archive path now that `delete_post` is out of scope. |
| `slab__add_topic_to_post` | `{postId, topicId}` | `addTopicToPost` | |
| `slab__remove_topic_from_post` | `{postId, topicId}` | `removeTopicFromPost` | |
| `slab__create_topic` | `{name, description?, parentId?, memberEditable?, privacy?, inheritParent?}` | `createTopic` | `description` accepts markdown; converted via Layer A to the schema's `Json` Delta. |
| `slab__update_topic` | `{topicId, name?, description?, parentId?, memberEditable?, privacy?, inheritParent?, propagatePrivacy?, bannerUrl?}` | `updateTopic` | Optional fields. |
| `slab__delete_topic` | `{topicId, confirm: true}` | `deleteTopic` | Destructive. Tool handler hard-fails with `SlabApiError` if `confirm !== true`. |

Enums (`PostLinkAccess`, `TopicPrivacy`, `TopicMemberEditable`, `PostContentFormat`) are exposed as TypeScript string-literal unions on the tool input schemas, with `enum` constraints in the JSON Schema so the MCP client gets autocomplete.

## 6. Read improvements

- `slab__get_post` response now surfaces: `version`, `publishedAt`, `archivedAt`, `linkAccess`, `topics[]` (id+name). `owner` already returned.
- `slab__list_posts` returns topic **ids only** on each post. The schema's `SlimTopic` exposes `id` but not `name` (`Slab@current--#@!api!@#.graphql:325`), so a name-and-id projection is not available on the slim listing path. Agents that need human-readable topic names call `slab__list_topics` once and join client-side, or call `slab__get_topic` for a specific id. (Doing the join inside `list_posts` would require an extra full `organization.topics` round trip per call; intentionally pushed to the caller, who can cache.)
- `slab__get_topic` *(new)* — `{topicId}`. Returns name, description (rendered to markdown via Layer A's inverse), parent, ancestors, children, posts (id+title), hierarchy.
- `slab__list_topics` *(new)* — no args. Returns flat list of topics from `organization.topics` with id, name, parent id. Agents use this to resolve human-friendly topic names to ids before `create_post` / `add_topic_to_post`.

## 7. Error handling

Add one new tagged error:

```ts
export class DeltaEditError extends Data.TaggedError("DeltaEditError")<{
  readonly message: string;
  readonly kind:
    | "not_found"
    | "ambiguous"
    | "mixed_attributes"
    | "parse_failure";
}> {}
```

Surface as actionable strings to the MCP caller, e.g. `"oldText 'foo' matched 3 times; add surrounding context to disambiguate"`. Existing `SlabApiError` / `SlabNetworkError` / `DeltaConversionError` unchanged.

Destructive operations gate at the tool handler:
- `slab__delete_topic` — missing/false `confirm` → `SlabApiError("delete_topic requires confirm: true to prevent accidental deletion")`. Never silently no-ops; the agent must pass the flag.

## 8. Testing

Test runner: `bun test` (per `CLAUDE.md`).

### Unit (always run)

- `test/delta/markdown-to-delta.test.ts` — fixtures cover headings 1–6, inline emphasis, links, images, fenced code w/ language, ordered+unordered+nested lists, blockquotes, hard breaks. Round-trip `md → delta → md` must match modulo whitespace normalisation. Each lossy edge (tables, footnotes, raw HTML) has an explicit "known-lossy" test that locks current behaviour.
- `test/delta/edits.test.ts` — pure:
  - `findReplace`: 0 → `not_found`, 2+ → `ambiguous`, 1 single-op → correct ops with preserved attrs, 1 spanning differing attrs → `mixed_attributes`, 1 spanning neighbouring ops with **identical** attrs → treated as single-op (no error); multiline `oldText`; embed in span counted as one character.
  - `append`: empty doc, single-`\n` tail, double-`\n` tail, embeds at tail.
  - `sectionReplace`: heading found / not found / multiple same-level (error) / nested-level boundary respected / end-of-doc span.
  - `fullReplaceDiff`: identical → empty diff; reorder paragraphs → minimal diff (asserts no full-document delete op present); format-only change → attribute-only ops.
- `test/posts.test.ts`, `test/topics.test.ts` — mock `fetch`; for each tool, assert the GraphQL request payload's `query` matches the expected constant and `variables` are wired correctly. Cover happy path + 1 GraphQL-error path per service.
- `test/formatters.test.ts` — extend for topic formatting + new post fields.
- `test/client.test.ts` — existing tests retained; trimmed to focus on transport behaviour only.

### Integration (gated)

Skipped unless both env vars present:

- `SLAB_API_TOKEN`
- `SLAB_TEST_TOPIC` — id of the `MCP-Testing` topic in the user's workspace

`test/integration/edit-roundtrip.test.ts`:
1. `create_post({title: "slabby-it-<timestamp>", topicId: SLAB_TEST_TOPIC, content: fixtureMd})`. Stash returned id.
2. `get_post(id)` → assert markdown equals fixture (modulo round-trip normalisation rules covered in unit tests).
3. `edit_post({oldText, newText})` → `get_post(id)` → assert exactly that one substring changed and surrounding text and formatting are intact.
4. `append_to_post({content: "..."})` → assert append at tail; original body byte-identical above the join.
5. `replace_section({heading: "Section A", content: "..."})` → assert section swap and that the heading itself, plus the next heading, are intact.
6. `update_post({content: <full new markdown>})` → `get_post(id)` → assert resulting content round-trips. **Diff-shape assertion** is captured by intercepting the GraphQL request payload via a `fetch` wrapper installed in test mode: for an edit that touches only the middle of the document, the outgoing Delta must contain at least one `retain` op preceding the change and must not be a single `{delete: <full length>}` followed by an `insert`. The `version` field is observed for sanity but not used as proof of diff path (any single mutation increments version by one).
7. `add_topic_to_post` then `remove_topic_from_post`, if a second topic id is available via `SLAB_TEST_TOPIC_SECONDARY`; else skip step.
8. Cleanup: `set_post_state({postId, archived: true})`. (Archive is the cleanup path now that `delete_post` is out of scope.)

`test/integration/topics.test.ts`:
- `list_topics` → finds `SLAB_TEST_TOPIC` by id, asserts name "MCP-Testing" returned.
- `get_topic({SLAB_TEST_TOPIC})` → asserts children / posts arrays parse correctly.

CI: unit tests run on every push; integration tests run on a separate workflow guarded by repo secrets. Local dev: developer sets the env vars in `.env`.

## 9. Migration notes

- Existing `update_post` callers continue to work — same tool name, same args. Behaviour changes from "delete-all then re-insert as plain text" to "minimal Delta diff via `quill-delta.diff`". Markdown-expressible formatting in the new content is preserved; constructs outside markdown's expressive range (tables, custom embed attributes) remain lossy on a full update — callers wanting to preserve those should use the targeted edit tools instead. No API break.
- `src/deltaToMarkdown.ts` moves to `src/delta/delta-to-markdown.ts`. Update one import in `client.ts` → `posts.ts`. No external API change.
- `package.json` adds two deps. Lockfile (`bun.lock`) regenerated.
- README updated: new tool list, edit-vs-update guidance, new env vars for integration tests.

## 10. Open questions

- **Markdown library choice.** `marked` chosen for sync API and small size; if a contributor strongly prefers `unified`/`remark` for AST richness, swap at implementation time — only `markdown-to-delta.ts` changes.
- **`set_post_state` arg semantics.** Slab's `updatePost` accepts only the fields you pass. Confirm at implementation time that passing `archived: false` actually unarchives (vs being treated as "no change"); doc the result in the tool description.
- **Topic `description` write path.** Schema accepts `description: Json` (Delta). Tool will accept markdown for ergonomics and convert via Layer A. Confirm a converted Delta with no attributes round-trips cleanly through Slab.

## 11. Implementation order

Suggested for follow-up plan (writing-plans skill will expand into discrete steps):

1. Add deps; relocate `deltaToMarkdown.ts` to `delta/`; verify all tests still pass (mechanical refactor).
2. Build `markdown-to-delta.ts` + unit tests.
3. Build `edits.ts` (pure builders) + unit tests.
4. Split `client.ts` → `client.ts` + `posts.ts`; rewire existing tools through `PostsService`; tests green.
5. Add new edit tools (`edit_post`, `append_to_post`, `replace_section`); swap `update_post` to Delta-diff path; tests.
6. Add `set_post_state`, `create_post`, `sync_post`, `add/remove_topic_from_post` tools; tests.
7. Add `topics.ts` service + topic tools (`get_topic`, `list_topics`, `create_topic`, `update_topic`, `delete_topic` with confirm gate); tests.
8. Extend `get_post` / `list_posts` to surface dropped fields.
9. Integration test suite (gated on env vars).
10. README + tool description polish; verify steering language picks `edit_post` over `update_post` for partial changes in an MCP client smoke test.
