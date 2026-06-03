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

export const allPostReadTools: ToolModule[] = [getPost];
export const allPostEditTools: ToolModule[] = [editPost, appendToPost, replaceSection, updatePost];
