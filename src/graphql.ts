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
 * GraphQL queries and mutations for Slab API
 *
 * ✅ VERIFIED against actual Slab GraphQL schema SDL from:
 * https://studio.apollographql.com/public/Slab/variant/current/explorer
 */

/**
 * Query to fetch a single post by ID
 *
 * Uses actual Slab schema fields:
 * - insertedAt (not createdAt)
 * - publishedAt, archivedAt
 * - content is in Delta/JSON format
 * - owner (not createdBy)
 */
export const GET_POST_QUERY = `
  query GetPost($id: ID!) {
    post(id: $id) {
      id
      title
      content
      linkAccess
      insertedAt
      updatedAt
      publishedAt
      archivedAt
      version
      owner {
        id
        name
        email
        title
        deactivatedAt
      }
    }
  }
`;

/**
 * Mutation to update a post's content using Delta format
 *
 * Slab uses Quill Delta format for content updates.
 * This helper creates a delta that replaces all content.
 *
 * Delta format example:
 * { "ops": [{"delete": N}, {"insert": "new content\n\n"}] }
 */
export const UPDATE_POST_CONTENT_MUTATION = `
  mutation UpdatePostContent($id: ID!, $delta: Json!) {
    updatePostContent(id: $id, delta: $delta) {
      id
      title
      content
      updatedAt
      version
    }
  }
`;

/**
 * Query to search for posts using cursor-based pagination
 *
 * Slab search follows GraphQL Relay cursor pagination pattern
 */
export const SEARCH_POSTS_QUERY = `
  query SearchPosts($query: String!, $first: Int, $after: String) {
    search(query: $query, types: [POST], first: $first, after: $after) {
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
      edges {
        cursor
        node {
          ... on PostSearchResult {
            title
            highlight
            post {
              id
              title
              content
              insertedAt
              publishedAt
              owner {
                id
                name
                email
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Query to get posts by IDs
 *
 * NOTE: Slab's posts query requires specific IDs, it doesn't support
 * topic filtering directly. To get posts by topic, you need to:
 * 1. Query the topic to get its posts
 * 2. Or use search with appropriate filters
 */
export const GET_POSTS_BY_IDS_QUERY = `
  query GetPostsByIds($ids: [ID!]!) {
    posts(ids: $ids) {
      id
      title
      content
      insertedAt
      publishedAt
      linkAccess
      owner {
        id
        name
        email
      }
      topics {
        id
        name
      }
    }
  }
`;

/**
 * Query to get a topic's posts
 *
 * This is the proper way to list posts in a topic according to Slab schema
 */
export const GET_TOPIC_POSTS_QUERY = `
  query GetTopicPosts($topicId: ID!) {
    topic(id: $topicId) {
      id
      name
      posts {
        id
        title
        content
        insertedAt
        publishedAt
        linkAccess
        owner {
          id
          name
          email
        }
      }
    }
  }
`;

/**
 * Query to get organization's all posts (if no topic filter needed)
 */
export const GET_ORGANIZATION_POSTS_QUERY = `
  query GetOrganizationPosts {
    organization {
      id
      posts {
        id
        title
        publishedAt
        linkAccess
        topics {
          id
        }
      }
    }
  }
`;

export const CREATE_POST_MUTATION = `
  mutation CreatePost($title: String, $topicId: ID, $templateId: ID) {
    createPost(title: $title, topicId: $topicId, templateId: $templateId) {
      id
      title
      content
      insertedAt
      updatedAt
      publishedAt
      archivedAt
      version
      owner { id name email }
    }
  }
`;

export const UPDATE_POST_STATE_MUTATION = `
  mutation UpdatePostState(
    $id: ID!,
    $ownerId: ID,
    $archived: Boolean,
    $published: Boolean,
    $linkAccess: PostLinkAccess,
    $bannerUrl: String
  ) {
    updatePost(
      id: $id,
      ownerId: $ownerId,
      archived: $archived,
      published: $published,
      linkAccess: $linkAccess,
      bannerUrl: $bannerUrl
    ) {
      id
      title
      publishedAt
      archivedAt
      linkAccess
      version
      owner { id name email }
    }
  }
`;

export const SYNC_POST_MUTATION = `
  mutation SyncPost(
    $externalId: ID!,
    $format: PostContentFormat!,
    $content: String!,
    $editUrl: String,
    $readUrl: String
  ) {
    syncPost(
      externalId: $externalId,
      format: $format,
      content: $content,
      editUrl: $editUrl,
      readUrl: $readUrl
    ) {
      id
      title
      insertedAt
      updatedAt
      version
    }
  }
`;

export const ADD_TOPIC_TO_POST_MUTATION = `
  mutation AddTopicToPost($postId: ID!, $topicId: ID!) {
    addTopicToPost(postId: $postId, topicId: $topicId) {
      id
      name
    }
  }
`;

export const REMOVE_TOPIC_FROM_POST_MUTATION = `
  mutation RemoveTopicFromPost($postId: ID!, $topicId: ID!) {
    removeTopicFromPost(postId: $postId, topicId: $topicId) {
      id
      name
    }
  }
`;

export const GET_TOPIC_QUERY = `
  query GetTopic($id: ID!) {
    topic(id: $id) {
      id
      name
      description
      privacy
      memberEditable
      inheritParent
      parent { id name }
      ancestors { id name }
      children { id name }
      posts {
        id
        title
        publishedAt
        archivedAt
        linkAccess
      }
      hierarchy
    }
  }
`;

export const LIST_TOPICS_QUERY = `
  query ListTopics {
    organization {
      id
      topics {
        id
        name
        parent { id }
        privacy
      }
    }
  }
`;

export const CREATE_TOPIC_MUTATION = `
  mutation CreateTopic(
    $name: String!,
    $description: Json,
    $parentId: ID,
    $memberEditable: TopicMemberEditable,
    $privacy: TopicPrivacy,
    $inheritParent: Boolean
  ) {
    createTopic(
      name: $name,
      description: $description,
      parentId: $parentId,
      memberEditable: $memberEditable,
      privacy: $privacy,
      inheritParent: $inheritParent
    ) {
      id
      name
    }
  }
`;

export const UPDATE_TOPIC_MUTATION = `
  mutation UpdateTopic(
    $id: ID!,
    $name: String,
    $description: Json,
    $parentId: ID,
    $memberEditable: TopicMemberEditable,
    $privacy: TopicPrivacy,
    $inheritParent: Boolean,
    $propagatePrivacy: Boolean,
    $bannerUrl: String
  ) {
    updateTopic(
      id: $id,
      name: $name,
      description: $description,
      parentId: $parentId,
      memberEditable: $memberEditable,
      privacy: $privacy,
      inheritParent: $inheritParent,
      propagatePrivacy: $propagatePrivacy,
      bannerUrl: $bannerUrl
    ) {
      id
      name
    }
  }
`;

export const DELETE_TOPIC_MUTATION = `
  mutation DeleteTopic($id: ID!) {
    deleteTopic(id: $id) {
      id
      name
    }
  }
`;
