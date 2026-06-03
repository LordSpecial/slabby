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
 * Slab GraphQL transport. Just performs raw GraphQL POST requests against
 * the Slab API and surfaces errors. Domain operations live in PostsService.
 */

import { Context, Effect, Layer, Data } from "effect";
import { ConfigService } from "./config.ts";

export class SlabApiError extends Data.TaggedError("SlabApiError")<{
  readonly message: string;
  readonly status?: number;
  readonly graphqlErrors?: any[];
}> {}

export class SlabNetworkError extends Data.TaggedError("SlabNetworkError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

interface GraphQLResponse<T = any> {
  data?: T;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: string[];
    extensions?: any;
  }>;
}

export interface SlabClientService {
  readonly request: <T>(query: string, variables?: Record<string, unknown>) =>
    Effect.Effect<T, SlabApiError | SlabNetworkError>;
}

export const SlabClientService = Context.GenericTag<SlabClientService>("@services/SlabClientService");

export const SlabClientServiceLive = Layer.effect(
  SlabClientService,
  Effect.gen(function* () {
    const { config } = yield* ConfigService;
    const { graphqlUrl, apiToken } = config;

    return {
      request: <T>(query: string, variables?: Record<string, unknown>) =>
        Effect.gen(function* () {
          const response = yield* Effect.tryPromise({
            try: () => fetch(graphqlUrl, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ query, variables }),
            }),
            catch: (error) => new SlabNetworkError({ message: `Network error: ${error}`, cause: error }),
          });

          if (!response.ok) {
            const errorText = yield* Effect.tryPromise({
              try: () => response.text(),
              catch: (error) => new SlabNetworkError({ message: `Unable to read error response: ${error}`, cause: error }),
            });
            return yield* Effect.fail(
              new SlabApiError({ message: `Slab GraphQL API error (${response.status}): ${errorText}`, status: response.status }),
            );
          }

          const json = yield* Effect.tryPromise({
            try: () => response.json() as Promise<GraphQLResponse<T>>,
            catch: (error) => new SlabNetworkError({ message: `Failed to parse JSON response: ${error}`, cause: error }),
          });

          if (json.errors && json.errors.length > 0) {
            const errorMessages = json.errors.map((e) => e.message).join(", ");
            return yield* Effect.fail(
              new SlabApiError({ message: `GraphQL errors: ${errorMessages}`, status: response.status, graphqlErrors: json.errors }),
            );
          }

          if (!json.data) {
            return yield* Effect.fail(new SlabApiError({ message: "GraphQL response missing data field", status: response.status }));
          }

          return json.data;
        }),
    };
  }),
);
