/**
 * Topics service. Wraps Slab GraphQL topic-related operations on top of the
 * SlabClientService transport. Owns the Delta ↔ markdown conversion path
 * for topic descriptions.
 */

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
