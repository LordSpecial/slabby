/**
 * Posts service. Wraps Slab GraphQL post-related operations on top of the
 * SlabClientService transport. Owns the Delta ↔ markdown conversion path
 * for post bodies.
 */

import { Context, Data, Effect, Layer } from "effect";
import type {
  SlabPost,
  SlabSearchResult,
  SlabListResult,
  SlabPostStateUpdate,
  SlabCreatePostInput,
  SlabSyncPostInput,
} from "./types.ts";
import { SlabClientService } from "./client.ts";
import type { SlabApiError, SlabNetworkError } from "./client.ts";
import {
  GET_POST_QUERY,
  UPDATE_POST_CONTENT_MUTATION,
  SEARCH_POSTS_QUERY,
  GET_TOPIC_POSTS_QUERY,
  GET_ORGANIZATION_POSTS_QUERY,
  CREATE_POST_MUTATION,
  UPDATE_POST_STATE_MUTATION,
  SYNC_POST_MUTATION,
  ADD_TOPIC_TO_POST_MUTATION,
  REMOVE_TOPIC_FROM_POST_MUTATION,
} from "./graphql.ts";
import { contentToMarkdown, DeltaConversionError } from "./delta/delta-to-markdown.ts";
import { markdownToDelta } from "./delta/markdown-to-delta.ts";
import type { Delta as DeltaShape } from "./delta/markdown-to-delta.ts";
import {
  buildFindReplaceDelta,
  buildAppendDelta,
  buildSectionReplaceDelta,
  buildFullReplaceDelta,
  DeltaEditError,
} from "./delta/edits.ts";

export class CreatePostInvalidArgsError extends Data.TaggedError("CreatePostInvalidArgsError")<{
  readonly message: string;
}> {}

export type PostsError =
  | SlabApiError
  | SlabNetworkError
  | DeltaConversionError
  | DeltaEditError
  | CreatePostInvalidArgsError;

export interface PostsService {
  readonly getPost: (postId: string) => Effect.Effect<SlabPost, PostsError>;
  readonly updatePostContent: (postId: string, delta: DeltaShape) => Effect.Effect<SlabPost, PostsError>;
  readonly searchPosts: (query: string) => Effect.Effect<SlabSearchResult, PostsError>;
  readonly listPosts: (topicId?: string) => Effect.Effect<SlabListResult, PostsError>;

  readonly editPost: (postId: string, oldText: string, newText: string) => Effect.Effect<SlabPost, PostsError>;
  readonly appendToPost: (postId: string, markdown: string) => Effect.Effect<SlabPost, PostsError>;
  readonly replaceSection: (postId: string, heading: string, markdown: string) => Effect.Effect<SlabPost, PostsError>;
  readonly fullReplacePost: (postId: string, markdown: string) => Effect.Effect<SlabPost, PostsError>;

  readonly createPost: (input: SlabCreatePostInput) => Effect.Effect<SlabPost, PostsError>;
  readonly setPostState: (input: SlabPostStateUpdate) => Effect.Effect<SlabPost, PostsError>;
  readonly syncPost: (input: SlabSyncPostInput) => Effect.Effect<SlabPost, PostsError>;
  readonly addTopicToPost: (postId: string, topicId: string) => Effect.Effect<{ id: string; name: string }, PostsError>;
  readonly removeTopicFromPost: (postId: string, topicId: string) => Effect.Effect<{ id: string; name: string }, PostsError>;
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

    const fetchRawContent = (postId: string) =>
      Effect.gen(function* () {
        const data = yield* transport.request<{ post: { content: any } }>(GET_POST_QUERY, { id: postId });
        const c = data.post.content;
        return { ops: Array.isArray(c) ? c : (c?.ops ?? []) } as DeltaShape;
      });

    const updatePostContent = (postId: string, delta: DeltaShape) =>
      Effect.gen(function* () {
        const data = yield* transport.request<{ updatePostContent: any }>(
          UPDATE_POST_CONTENT_MUTATION,
          { id: postId, delta },
        );
        return yield* transformPost(data.updatePostContent);
      });

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
          const current = yield* fetchRawContent(postId);
          const patch = yield* buildFindReplaceDelta(current, oldText, newText);
          return yield* updatePostContent(postId, patch);
        }),

      appendToPost: (postId, markdown) =>
        Effect.gen(function* () {
          const current = yield* fetchRawContent(postId);
          const patch = yield* buildAppendDelta(current, markdown);
          return yield* updatePostContent(postId, patch);
        }),

      replaceSection: (postId, heading, markdown) =>
        Effect.gen(function* () {
          const current = yield* fetchRawContent(postId);
          const patch = yield* buildSectionReplaceDelta(current, heading, markdown);
          return yield* updatePostContent(postId, patch);
        }),

      fullReplacePost: (postId, markdown) =>
        Effect.gen(function* () {
          const current = yield* fetchRawContent(postId);
          const patch = yield* buildFullReplaceDelta(current, markdown);
          return yield* updatePostContent(postId, patch);
        }),

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
    };
  }),
);
