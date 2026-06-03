/**
 * MCP tool definitions for search/list_posts slabby tools. Each export pairs
 * a tool descriptor with its handler. `src/index.ts` collects these into the
 * MCP server's tool list.
 */

import { Effect } from "effect";
import { PostsService } from "../posts.ts";
import { formatSearchResults, formatListResults } from "../formatters.ts";
import type { ToolModule } from "./posts.ts";

export const search: ToolModule = {
  definition: {
    name: "slab__search",
    description: "Search for posts across your Slab workspace.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Search query string." } },
      required: ["query"],
    },
  },
  handler: (args) =>
    Effect.gen(function* () {
      const posts = yield* PostsService;
      const results = yield* posts.searchPosts(args.query as string);
      return formatSearchResults(results, args.query as string);
    }),
};

export const listPosts: ToolModule = {
  definition: {
    name: "slab__list_posts",
    description:
      "List posts in your Slab workspace, optionally filtered by topic. Returns each post with topic ids (no names). Resolve names via slab__list_topics.",
    inputSchema: {
      type: "object",
      properties: { topicId: { type: "string", description: "Optional topic ID to filter posts." } },
    },
  },
  handler: (args) =>
    Effect.gen(function* () {
      const posts = yield* PostsService;
      const results = yield* posts.listPosts(args.topicId as string | undefined);
      return formatListResults(results);
    }),
};

export const allSearchTools: ToolModule[] = [search, listPosts];
