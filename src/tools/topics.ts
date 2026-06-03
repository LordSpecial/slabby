/**
 * MCP tool definitions for topic-related slabby tools. Each export pairs a
 * tool descriptor with its handler. `src/index.ts` collects these into the
 * MCP server's tool list.
 */

import { Effect } from "effect";
import { TopicsService } from "../topics.ts";
import { formatTopicResponse, formatTopicList } from "../formatters.ts";
import type { ToolModule } from "./posts.ts";

export const getTopic: ToolModule = {
  definition: {
    name: "slab__get_topic",
    description:
      "Fetch a Slab topic by ID. Returns the topic's name, description, privacy, parent/ancestors/children, and the posts it contains.",
    inputSchema: {
      type: "object",
      properties: { topicId: { type: "string", description: "Slab topic ID." } },
      required: ["topicId"],
    },
  },
  handler: (args) =>
    Effect.gen(function* () {
      const topics = yield* TopicsService;
      const t = yield* topics.getTopic(args.topicId as string);
      return formatTopicResponse(t);
    }),
};

export const listTopics: ToolModule = {
  definition: {
    name: "slab__list_topics",
    description:
      "List all topics in your Slab organization. Returns a flat list with id, name, parent id, and privacy. Use this to resolve human-friendly topic names to ids before slab__create_post or slab__add_topic_to_post.",
    inputSchema: { type: "object", properties: {} },
  },
  handler: (_args) =>
    Effect.gen(function* () {
      const topics = yield* TopicsService;
      const list = yield* topics.listTopics();
      return formatTopicList(list);
    }),
};

export const createTopic: ToolModule = {
  definition: {
    name: "slab__create_topic",
    description: "Create a new Slab topic.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Topic name." },
        description: { type: "string", description: "Optional markdown description." },
        parentId: { type: "string", description: "Optional parent topic id." },
        memberEditable: {
          type: "string",
          enum: ["ALL", "POST", "NONE"],
          description: "Who can edit posts in this topic.",
        },
        privacy: {
          type: "string",
          enum: ["OPEN", "PRIVATE", "SECRET", "PUBLIC"],
          description: "Topic privacy.",
        },
        inheritParent: { type: "boolean", description: "Inherit owners/members from parent topic." },
      },
      required: ["name"],
    },
  },
  handler: (args) =>
    Effect.gen(function* () {
      const topics = yield* TopicsService;
      const t = yield* topics.createTopic({
        name: args.name as string,
        description: args.description as string | undefined,
        parentId: args.parentId as string | undefined,
        memberEditable: args.memberEditable as any,
        privacy: args.privacy as any,
        inheritParent: args.inheritParent as boolean | undefined,
      });
      return `Topic created: ${t.name} (${t.id})`;
    }),
};

export const updateTopic: ToolModule = {
  definition: {
    name: "slab__update_topic",
    description: "Update an existing Slab topic. Only fields you pass are sent.",
    inputSchema: {
      type: "object",
      properties: {
        topicId: { type: "string" },
        name: { type: "string" },
        description: { type: "string", description: "Markdown description." },
        parentId: { type: "string" },
        memberEditable: { type: "string", enum: ["ALL", "POST", "NONE"] },
        privacy: { type: "string", enum: ["OPEN", "PRIVATE", "SECRET", "PUBLIC"] },
        inheritParent: { type: "boolean" },
        propagatePrivacy: { type: "boolean", description: "If true, propagate privacy change to subtopics." },
        bannerUrl: { type: "string" },
      },
      required: ["topicId"],
    },
  },
  handler: (args) =>
    Effect.gen(function* () {
      const topics = yield* TopicsService;
      const t = yield* topics.updateTopic({
        topicId: args.topicId as string,
        name: args.name as string | undefined,
        description: args.description as string | undefined,
        parentId: args.parentId as string | undefined,
        memberEditable: args.memberEditable as any,
        privacy: args.privacy as any,
        inheritParent: args.inheritParent as boolean | undefined,
        propagatePrivacy: args.propagatePrivacy as boolean | undefined,
        bannerUrl: args.bannerUrl as string | undefined,
      });
      return `Topic updated: ${t.name} (${t.id})`;
    }),
};

export const deleteTopic: ToolModule = {
  definition: {
    name: "slab__delete_topic",
    description:
      "Delete a Slab topic. DESTRUCTIVE. Requires confirm: true. Posts inside the topic are NOT deleted; they become un-categorised.",
    inputSchema: {
      type: "object",
      properties: {
        topicId: { type: "string", description: "Topic ID to delete." },
        confirm: {
          type: "boolean",
          description: "Must be literally true; the call fails otherwise.",
        },
      },
      required: ["topicId", "confirm"],
    },
  },
  handler: (args) =>
    Effect.gen(function* () {
      const topics = yield* TopicsService;
      const t = yield* topics.deleteTopic(args.topicId as string, args.confirm === true);
      return `Topic deleted: ${t.name} (${t.id})`;
    }),
};

export const allTopicTools: ToolModule[] = [getTopic, listTopics, createTopic, updateTopic, deleteTopic];
