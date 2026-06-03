import { test, expect, describe } from "bun:test";
import { Effect } from "effect";
import { TopicsService } from "../../src/topics.ts";
import { isIntegrationEnabled, runWithServices } from "./_helpers.ts";

const skipIfDisabled = (name: string, body: () => Promise<void>, timeoutMs?: number) =>
  isIntegrationEnabled() ? test(name, body, timeoutMs) : test.skip(name, body, timeoutMs);

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
