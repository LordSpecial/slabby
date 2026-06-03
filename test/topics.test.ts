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
