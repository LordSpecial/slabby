/**
 * MCP tool definitions for post-related slabby tools. Each export pairs a
 * tool descriptor with its handler. `src/index.ts` collects these into the
 * MCP server's tool list.
 */

import { Effect } from "effect";
import { PostsService } from "../posts.ts";
import { extractPostId } from "../utils.ts";
import { formatPostResponse } from "../formatters.ts";

export interface ToolModule {
  definition: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  };
  handler: (args: any) => Effect.Effect<string, any, PostsService>;
}

export const getPost: ToolModule = {
  definition: {
    name: "slab__get_post",
    description: "Fetch a Slab post by ID or URL. Returns the post content in markdown format.",
    inputSchema: {
      type: "object",
      properties: {
        postId: {
          type: "string",
          description: "The Slab post ID or full post URL (e.g. 'abc123' or 'https://team.slab.com/posts/abc123')",
        },
      },
      required: ["postId"],
    },
  },
  handler: (args) =>
    Effect.gen(function* () {
      const posts = yield* PostsService;
      const postId = yield* extractPostId(args.postId as string);
      const post = yield* posts.getPost(postId);
      return formatPostResponse(post);
    }),
};

export const editPost: ToolModule = {
  definition: {
    name: "slab__edit_post",
    description:
      "PREFER THIS for small or targeted edits. Replace one exact substring (oldText) in a Slab post's content with newText. oldText must be unique in the post, must be contained within a single formatting run (no spanning bold/plain/code boundaries), and is matched literally including whitespace. Returns the updated post.",
    inputSchema: {
      type: "object",
      properties: {
        postId: { type: "string", description: "Slab post ID or URL." },
        oldText: { type: "string", description: "Exact substring to find. Must be unique and within a single formatting run." },
        newText: { type: "string", description: "Replacement text. Inherits the matched run's formatting attributes." },
      },
      required: ["postId", "oldText", "newText"],
    },
  },
  handler: (args) =>
    Effect.gen(function* () {
      const posts = yield* PostsService;
      const postId = yield* extractPostId(args.postId as string);
      const post = yield* posts.editPost(postId, args.oldText as string, args.newText as string);
      return formatPostResponse(post);
    }),
};

export const appendToPost: ToolModule = {
  definition: {
    name: "slab__append_to_post",
    description:
      "Append markdown content to the end of a Slab post. Inserts at least two newlines between the existing content and the appended content. Use for adding new sections/paragraphs without touching existing content.",
    inputSchema: {
      type: "object",
      properties: {
        postId: { type: "string", description: "Slab post ID or URL." },
        content: { type: "string", description: "Markdown content to append." },
      },
      required: ["postId", "content"],
    },
  },
  handler: (args) =>
    Effect.gen(function* () {
      const posts = yield* PostsService;
      const postId = yield* extractPostId(args.postId as string);
      const post = yield* posts.appendToPost(postId, args.content as string);
      return formatPostResponse(post);
    }),
};

export const replaceSection: ToolModule = {
  definition: {
    name: "slab__replace_section",
    description:
      "Replace the body of a specific section identified by its heading. The heading line itself is preserved; the body between this heading and the next heading of the same or higher level (or end-of-document) is replaced with the supplied markdown. heading must match a unique heading line in the post.",
    inputSchema: {
      type: "object",
      properties: {
        postId: { type: "string", description: "Slab post ID or URL." },
        heading: { type: "string", description: "Exact heading text (without leading #s)." },
        content: { type: "string", description: "Markdown content to insert as the new section body." },
      },
      required: ["postId", "heading", "content"],
    },
  },
  handler: (args) =>
    Effect.gen(function* () {
      const posts = yield* PostsService;
      const postId = yield* extractPostId(args.postId as string);
      const post = yield* posts.replaceSection(postId, args.heading as string, args.content as string);
      return formatPostResponse(post);
    }),
};

export const updatePost: ToolModule = {
  definition: {
    name: "slab__update_post",
    description:
      "Full-document rewrite. Use only for total replacement; prefer slab__edit_post for partial changes. Constructs not expressible in markdown (e.g. tables, certain embed attributes) may be lost on a full update — use the targeted edit tools to avoid touching those regions.",
    inputSchema: {
      type: "object",
      properties: {
        postId: { type: "string", description: "Slab post ID or URL." },
        content: { type: "string", description: "Full replacement markdown." },
      },
      required: ["postId", "content"],
    },
  },
  handler: (args) =>
    Effect.gen(function* () {
      const posts = yield* PostsService;
      const postId = yield* extractPostId(args.postId as string);
      const post = yield* posts.fullReplacePost(postId, args.content as string);
      return formatPostResponse(post);
    }),
};

export const createPost: ToolModule = {
  definition: {
    name: "slab__create_post",
    description:
      "Create a new Slab post. Provide title (required), and optionally topicId, content (markdown), or templateId. content and templateId are mutually exclusive — pick at most one.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Post title." },
        topicId: { type: "string", description: "Optional topic to place the post under." },
        content: { type: "string", description: "Optional initial body as markdown. Mutually exclusive with templateId." },
        templateId: { type: "string", description: "Optional template id to seed the post body. Mutually exclusive with content." },
      },
      required: ["title"],
    },
  },
  handler: (args) =>
    Effect.gen(function* () {
      const posts = yield* PostsService;
      const post = yield* posts.createPost({
        title: args.title as string,
        topicId: args.topicId as string | undefined,
        content: args.content as string | undefined,
        templateId: args.templateId as string | undefined,
      });
      return formatPostResponse(post);
    }),
};

export const setPostState: ToolModule = {
  definition: {
    name: "slab__set_post_state",
    description:
      "Update a Slab post's state without changing its content: archive/unarchive, publish/unpublish, change link access, transfer ownership, change banner. All fields except postId are optional; only those provided are sent. Note: there is no delete_post tool — archive a post via {archived: true} instead.",
    inputSchema: {
      type: "object",
      properties: {
        postId: { type: "string", description: "Slab post ID or URL." },
        ownerId: { type: "string", description: "Transfer ownership to this user ID." },
        archived: { type: "boolean", description: "true to archive, false to unarchive." },
        published: { type: "boolean", description: "true to publish, false to unpublish." },
        linkAccess: {
          type: "string",
          enum: ["INTERNAL", "INTERNAL_VIEW", "PUBLIC", "PUBLIC_EDIT", "DISABLED"],
          description: "Post link access level.",
        },
        bannerUrl: { type: "string", description: "URL of a banner image." },
      },
      required: ["postId"],
    },
  },
  handler: (args) =>
    Effect.gen(function* () {
      const posts = yield* PostsService;
      const postId = yield* extractPostId(args.postId as string);
      const post = yield* posts.setPostState({
        postId,
        ownerId: args.ownerId as string | undefined,
        archived: args.archived as boolean | undefined,
        published: args.published as boolean | undefined,
        linkAccess: args.linkAccess as any,
        bannerUrl: args.bannerUrl as string | undefined,
      });
      return formatPostResponse(post);
    }),
};

export const syncPost: ToolModule = {
  definition: {
    name: "slab__sync_post",
    description:
      "Create or update a Slab post that mirrors content from an external source (e.g. a GitHub README). The resulting post is READ-ONLY in Slab — Slab users cannot edit it. Use this when the source of truth lives outside Slab. format must be 'MARKDOWN' or 'HTML'.",
    inputSchema: {
      type: "object",
      properties: {
        externalId: { type: "string", description: "Caller-stable id for the external source." },
        format: { type: "string", enum: ["MARKDOWN", "HTML"], description: "Content format." },
        content: { type: "string", description: "Full content in the chosen format." },
        editUrl: { type: "string", description: "Link to edit the source." },
        readUrl: { type: "string", description: "Optional read-only link; defaults to editUrl." },
      },
      required: ["externalId", "format", "content", "editUrl"],
    },
  },
  handler: (args) =>
    Effect.gen(function* () {
      const posts = yield* PostsService;
      const post = yield* posts.syncPost({
        externalId: args.externalId as string,
        format: args.format as any,
        content: args.content as string,
        editUrl: args.editUrl as string,
        readUrl: args.readUrl as string | undefined,
      });
      return formatPostResponse(post);
    }),
};

export const addTopicToPost: ToolModule = {
  definition: {
    name: "slab__add_topic_to_post",
    description: "Attach a topic to a post.",
    inputSchema: {
      type: "object",
      properties: {
        postId: { type: "string", description: "Slab post ID or URL." },
        topicId: { type: "string", description: "Topic ID to attach." },
      },
      required: ["postId", "topicId"],
    },
  },
  handler: (args) =>
    Effect.gen(function* () {
      const posts = yield* PostsService;
      const postId = yield* extractPostId(args.postId as string);
      const topic = yield* posts.addTopicToPost(postId, args.topicId as string);
      return `Topic attached. Post: ${postId}, Topic: ${topic.id} (${topic.name})`;
    }),
};

export const removeTopicFromPost: ToolModule = {
  definition: {
    name: "slab__remove_topic_from_post",
    description: "Detach a topic from a post.",
    inputSchema: {
      type: "object",
      properties: {
        postId: { type: "string", description: "Slab post ID or URL." },
        topicId: { type: "string", description: "Topic ID to detach." },
      },
      required: ["postId", "topicId"],
    },
  },
  handler: (args) =>
    Effect.gen(function* () {
      const posts = yield* PostsService;
      const postId = yield* extractPostId(args.postId as string);
      const topic = yield* posts.removeTopicFromPost(postId, args.topicId as string);
      return `Topic detached. Post: ${postId}, Topic: ${topic.id} (${topic.name})`;
    }),
};

export const allPostReadTools: ToolModule[] = [getPost];
export const allPostEditTools: ToolModule[] = [editPost, appendToPost, replaceSection, updatePost];
export const allPostMutationTools: ToolModule[] = [
  createPost,
  setPostState,
  syncPost,
  addTopicToPost,
  removeTopicFromPost,
];
