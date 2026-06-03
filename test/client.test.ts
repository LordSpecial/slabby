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
