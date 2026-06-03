import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import { Effect, Layer, Context } from "effect";
import { SlabClientServiceLive } from "../src/client.ts";
import type { PostsService } from "../src/posts.ts";
import { PostsServiceLive } from "../src/posts.ts";
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

  afterEach(() => {
    // Restore original fetch
    global.fetch = originalFetch;
    mockFetch.mockClear();
  });

  describe("getPost", () => {
    test("should fetch a post by ID using GraphQL with actual schema", async () => {
      const mockGraphQLResponse = {
        data: {
          post: {
            id: "123",
            title: "Test Post",
            content: [{ insert: "Test content" }, { insert: "\n\n" }], // Quill Delta format
            insertedAt: "2024-01-01T00:00:00Z",
            updatedAt: "2024-01-02T00:00:00Z",
            publishedAt: "2024-01-01T00:00:00Z",
            archivedAt: null,
            owner: {
              id: "user1",
              name: "Test User",
              email: "test@example.com",
            },
          },
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockGraphQLResponse,
      });

      const result = await Effect.runPromise(posts.getPost("123"));

      expect(result.id).toBe("123");
      expect(result.title).toBe("Test Post");
      expect(result.content).toBe("Test content"); // Converted from Delta
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.slab.com/v1/graphql",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
            "Content-Type": "application/json",
          }),
          body: expect.stringContaining("GetPost"),
        })
      );
    });

    test("should fail on GraphQL errors", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          errors: [{ message: "Post not found" }],
        }),
      });

      const result = await Effect.runPromise(posts.getPost("nonexistent").pipe(Effect.either));
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left.message).toContain("Post not found");
      }
    });

    test("should fail on HTTP errors", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => "Forbidden",
      });

      const result = await Effect.runPromise(posts.getPost("123").pipe(Effect.either));
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left.message).toContain("403");
      }
    });
  });

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

  describe("searchPosts", () => {
    test("should search posts using cursor pagination", async () => {
      const mockGraphQLResponse = {
        data: {
          search: {
            pageInfo: {
              hasNextPage: false,
              hasPreviousPage: false,
              startCursor: "cursor1",
              endCursor: "cursor2",
            },
            edges: [
              {
                cursor: "cursor1",
                node: {
                  title: "Result 1",
                  post: {
                    id: "1",
                    title: "Result 1",
                    content: [{ insert: "Content 1" }, { insert: "\n\n" }],
                    insertedAt: "2024-01-01T00:00:00Z",
                    publishedAt: "2024-01-01T00:00:00Z",
                    owner: {
                      id: "user1",
                      name: "Test User",
                      email: "test@example.com",
                    },
                  },
                },
              },
            ],
          },
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockGraphQLResponse,
      });

      const result = await Effect.runPromise(posts.searchPosts("test query"));

      expect(result.posts).toHaveLength(1);
      expect(result.posts[0]?.title).toBe("Result 1");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.slab.com/v1/graphql",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("SearchPosts"),
        })
      );
    });
  });

  describe("getPost edge cases", () => {
    test("should handle post with no owner", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            post: {
              id: "456",
              title: "Orphan Post",
              content: [{ insert: "Content" }, { insert: "\n\n" }],
              insertedAt: "2024-01-01T00:00:00Z",
              updatedAt: "2024-01-02T00:00:00Z",
            },
          },
        }),
      });

      const result = await Effect.runPromise(posts.getPost("456"));
      expect(result.id).toBe("456");
      expect(result.created_by).toBeUndefined();
    });

    test("should handle post with string content", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            post: {
              id: "789",
              title: "String Content Post",
              content: "Already a string",
              insertedAt: "2024-01-01T00:00:00Z",
              updatedAt: "2024-01-02T00:00:00Z",
            },
          },
        }),
      });

      const result = await Effect.runPromise(posts.getPost("789"));
      expect(result.content).toBe("Already a string");
    });

    test("should handle post with null content", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            post: {
              id: "000",
              title: "Empty Post",
              content: null,
              insertedAt: "2024-01-01T00:00:00Z",
              updatedAt: "2024-01-02T00:00:00Z",
            },
          },
        }),
      });

      const result = await Effect.runPromise(posts.getPost("000"));
      expect(result.content).toBe("");
    });

    test("should handle post with empty delta array", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            post: {
              id: "empty",
              title: "Empty Delta",
              content: [],
              insertedAt: "2024-01-01T00:00:00Z",
              updatedAt: "2024-01-02T00:00:00Z",
            },
          },
        }),
      });

      const result = await Effect.runPromise(posts.getPost("empty"));
      expect(result.content).toBe("");
    });

    test("should fail when response has no data field", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      const result = await Effect.runPromise(posts.getPost("123").pipe(Effect.either));
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("SlabApiError");
        expect(result.left.message).toContain("missing data field");
      }
    });

    test("should fail on network error", async () => {
      mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

      const result = await Effect.runPromise(posts.getPost("123").pipe(Effect.either));
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("SlabNetworkError");
      }
    });

    test("should fail on multiple GraphQL errors", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          errors: [
            { message: "First error" },
            { message: "Second error" },
          ],
        }),
      });

      const result = await Effect.runPromise(posts.getPost("123").pipe(Effect.either));
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left.message).toContain("First error");
        expect(result.left.message).toContain("Second error");
      }
    });
  });

  describe("searchPosts edge cases", () => {
    test("should handle empty search results", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            search: {
              pageInfo: { hasNextPage: false, hasPreviousPage: false },
              edges: [],
            },
          },
        }),
      });

      const result = await Effect.runPromise(posts.searchPosts("nonexistent"));
      expect(result.posts).toHaveLength(0);
      expect(result.total_count).toBe(0);
    });

    test("should skip edges with null nodes or missing post", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            search: {
              pageInfo: { hasNextPage: false, hasPreviousPage: false },
              edges: [
                { cursor: "c1", node: null },
                { cursor: "c2", node: { title: "No post field" } },
              ],
            },
          },
        }),
      });

      const result = await Effect.runPromise(posts.searchPosts("test"));
      expect(result.posts).toHaveLength(0);
    });
  });

  describe("listPosts edge cases", () => {
    test("should handle empty topic posts", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            topic: {
              id: "topic-empty",
              name: "Empty Topic",
              posts: [],
            },
          },
        }),
      });

      const result = await Effect.runPromise(posts.listPosts("topic-empty"));
      expect(result.posts).toHaveLength(0);
      expect(result.total_count).toBe(0);
    });

    test("should handle empty organization posts", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            organization: {
              id: "org1",
              posts: [],
            },
          },
        }),
      });

      const result = await Effect.runPromise(posts.listPosts());
      expect(result.posts).toHaveLength(0);
      expect(result.total_count).toBe(0);
    });
  });

  describe("listPosts", () => {
    test("should list all posts from organization when no topic ID provided", async () => {
      const mockGraphQLResponse = {
        data: {
          organization: {
            id: "org1",
            posts: [
              {
                id: "1",
                title: "Post 1",
                publishedAt: "2024-01-01T00:00:00Z",
                linkAccess: "INTERNAL",
                topics: [{ id: "topic1" }],
              },
            ],
          },
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockGraphQLResponse,
      });

      const result = await Effect.runPromise(posts.listPosts());

      expect(result.posts).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.slab.com/v1/graphql",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("GetOrganizationPosts"),
        })
      );
    });

    test("should list posts from a specific topic", async () => {
      const mockGraphQLResponse = {
        data: {
          topic: {
            id: "topic-123",
            name: "Engineering",
            posts: [
              {
                id: "1",
                title: "Post 1",
                content: [{ insert: "Content" }, { insert: "\n\n" }],
                insertedAt: "2024-01-01T00:00:00Z",
                publishedAt: "2024-01-01T00:00:00Z",
                linkAccess: "INTERNAL",
                owner: {
                  id: "user1",
                  name: "Test User",
                  email: "test@example.com",
                },
              },
            ],
          },
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockGraphQLResponse,
      });

      const result = await Effect.runPromise(posts.listPosts("topic-123"));

      expect(result.posts).toHaveLength(1);
      const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body);
      expect(body.query).toContain("GetTopicPosts");
      expect(body.variables.topicId).toBe("topic-123");
    });
  });

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
});
