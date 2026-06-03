import { test, expect, describe } from "bun:test";
import { Effect } from "effect";
import { PostsService } from "../../src/posts.ts";
import { isIntegrationEnabled, runWithServices } from "./_helpers.ts";

const skipIfDisabled = (name: string, body: () => Promise<void>, timeoutMs?: number) =>
  isIntegrationEnabled() ? test(name, body, timeoutMs) : test.skip(name, body, timeoutMs);

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
