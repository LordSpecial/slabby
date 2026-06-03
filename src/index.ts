#!/usr/bin/env bun

/**
 * Copyright 2025 Russ White
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Slabby - MCP Server for Slab Knowledge Base Integration
 *
 * Enables AI coding agents to read and update Slab documentation.
 * All edits are attributed to the user who owns the API token.
 */

import { Effect, Layer } from "effect";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { ConfigService, ConfigServiceLive } from "./config.ts";
import { SlabClientServiceLive } from "./client.ts";
import { PostsServiceLive } from "./posts.ts";
import { TopicsServiceLive } from "./topics.ts";
import { allPostEditTools, allPostReadTools, allPostMutationTools } from "./tools/posts.ts";
import { allTopicTools } from "./tools/topics.ts";
import { allSearchTools } from "./tools/search.ts";

/**
 * The main application layer combining all services
 */
const SlabClientLayer = SlabClientServiceLive.pipe(Layer.provide(ConfigServiceLive));

const AppLayer = Layer.mergeAll(
  ConfigServiceLive,
  SlabClientLayer,
  PostsServiceLive.pipe(Layer.provide(SlabClientLayer)),
  TopicsServiceLive.pipe(Layer.provide(SlabClientLayer)),
);

/**
 * Unified tool registry. Every tool is a `ToolModule` exporting its
 * MCP definition and an Effect-based handler. The MCP server's list and
 * call handlers are driven entirely by this registry.
 */
const allTools = [
  ...allPostReadTools,
  ...allPostEditTools,
  ...allPostMutationTools,
  ...allTopicTools,
  ...allSearchTools,
];

const toolHandlers: Record<string, (args: any) => Effect.Effect<string, any>> = Object.fromEntries(
  allTools.map((t) => [t.definition.name, t.handler]),
) as Record<string, (args: any) => Effect.Effect<string, any>>;

/**
 * Create and configure the MCP server
 */
function createServer() {
  const server = new Server(
    {
      name: "slabby",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tool list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools.map((t) => t.definition),
  }));

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (!args) {
      return {
        content: [
          {
            type: "text",
            text: "Error: Missing required arguments",
          },
        ],
        isError: true,
      };
    }

    // Get the handler for this tool
    const handler = toolHandlers[name as keyof typeof toolHandlers];
    if (!handler) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Unknown tool: ${name}`,
          },
        ],
        isError: true,
      };
    }

    // Run the Effect with the app layer and handle errors
    const result = await Effect.runPromise(
      handler(args).pipe(
        Effect.provide(AppLayer),
        Effect.catchAll((error) =>
          Effect.succeed(`Error: ${error.message || String(error)}`)
        )
      )
    );

    return {
      content: [
        {
          type: "text",
          text: result,
        },
      ],
    };
  });

  return server;
}

/**
 * Start the MCP server
 */
async function main() {
  // Validate configuration first by loading it
  const configProgram = Effect.gen(function* () {
    const { config } = yield* ConfigService;
    return config;
  }).pipe(Effect.provide(ConfigServiceLive), Effect.either);

  const configResult = await Effect.runPromise(configProgram);

  if (configResult._tag === "Left") {
    const error = configResult.left as any;
    console.error("Configuration error:", error.message || String(error));
    process.exit(1);
  }

  // Create and start the server
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Slabby MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
