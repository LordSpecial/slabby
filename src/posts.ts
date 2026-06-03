/**
 * Posts service. Wraps Slab GraphQL post-related operations on top of the
 * SlabClientService transport. Owns the Delta ↔ markdown conversion path
 * for post bodies.
 */

import { Context, Effect, Layer } from "effect";
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
