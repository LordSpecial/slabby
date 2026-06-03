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
