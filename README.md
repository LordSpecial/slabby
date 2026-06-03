# 🧱 Slabby

[![npm version](https://badge.fury.io/js/@russwyte%2Fslabby.svg)](https://badge.fury.io/js/@russwyte%2Fslabby)
[![Tests](https://github.com/russwyte/slabby/actions/workflows/test.yml/badge.svg)](https://github.com/russwyte/slabby/actions/workflows/test.yml)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

**MCP server for Slab knowledge base integration with AI coding agents**

Slabby is a [Model Context Protocol](https://modelcontextprotocol.io) server that enables AI coding agents like Claude Code, Cline, and others to read and update your Slab documentation directly. Perfect for keeping RFCs, technical docs, and team wikis in sync with your development workflow.

## Features

- 📖 **Read** Slab posts by ID or URL (now with version, publishedAt, archivedAt, linkAccess, topics).
- ✏️ **Surgical editing** via Quill Delta:
  - `slab__edit_post` — find-and-replace on a unique substring (preferred for targeted edits).
  - `slab__append_to_post` — append markdown to the end of a post.
  - `slab__replace_section` — replace the body under a uniquely-named heading.
  - `slab__update_post` — full-document rewrite via a minimal Delta diff (for total rewrites).
- 🏗️ **Post lifecycle:** `slab__create_post`, `slab__set_post_state` (archive/publish/owner/linkAccess/banner), `slab__sync_post` (mirror external sources).
- 🏷️ **Topics:** `slab__get_topic`, `slab__list_topics`, `slab__create_topic`, `slab__update_topic`, `slab__delete_topic` (destructive — requires `confirm: true`), `slab__add_topic_to_post`, `slab__remove_topic_from_post`.
- 🔍 **Search and listing:** `slab__search`, `slab__list_posts`.
- 🔐 Personal Slab API token, never sent to Anthropic's servers.

## Installation

### For Development

```bash
git clone https://github.com/russwyte/slabby.git
cd slabby
bun install
```

### From npm

```bash
npm install -g @russwyte/slabby
# or
bun install -g @russwyte/slabby
```

## Configuration

### 1. Get your Slab API token

1. Go to your Slab workspace → **Settings** → **API**
2. Generate a new API token
3. Copy the token (you'll need it in the next step)

### 2. Set up environment variables

Create a `.env` file in the project root:

```bash
SLAB_API_TOKEN=your-api-token-here
SLAB_TEAM=your-team-domain  # e.g., "acme" for acme.slab.com
```

**Security Note:** Never commit your `.env` file to git. It's already in `.gitignore`.

### 3. Configure Claude Code

Add Slabby to your Claude Code MCP settings:

**macOS/Linux:** `~/.config/claude-code/claude_desktop_config.json`
**Windows:** `%APPDATA%\claude-code\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "slabby": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/slabby/index.ts"],
      "env": {
        "SLAB_API_TOKEN": "your-token-here",
        "SLAB_TEAM": "your-team-domain"
      }
    }
  }
}
```

**Tip:** You can also use environment variables instead of hardcoding the token:

```json
{
  "mcpServers": {
    "slabby": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/slabby/index.ts"],
      "env": {
        "SLAB_API_TOKEN": "${SLAB_API_TOKEN}",
        "SLAB_TEAM": "${SLAB_TEAM}"
      }
    }
  }
}
```

## Usage

Once configured, Claude Code will automatically have access to these tools:

### `slab__get_post`
Fetch a Slab post by ID or URL:
```
Claude, read the Atlas RFC from https://myteam.slab.com/posts/atlas-rfc-xyz123
```

### `slab__update_post`
Update a Slab post:
```
Claude, update the Atlas RFC to reflect the single goal change
```

### `slab__search`
Search across your Slab workspace:
```
Claude, search Slab for all documents about "marketing automation"
```

### `slab__list_posts`
List posts in a topic:
```
Claude, show me all RFCs in the Engineering topic
```

## Development

### Run in development mode (with auto-reload):
```bash
bun run dev
```

### Run in production mode:
```bash
bun run start
```

### Test the MCP server:
```bash
# Using the MCP inspector (install separately)
npx @modelcontextprotocol/inspector bun run index.ts
```

### Integration tests

`test/integration/` contains tests that hit the real Slab API. They are skipped unless **all three** of these env vars are set:

- `SLAB_API_TOKEN` — your API token.
- `SLAB_TEAM` — your Slab subdomain.
- `SLAB_TEST_TOPIC` — the ID of a topic used as a scratch space (the project maintains a topic named `MCP-Testing` for this purpose). Each run creates a fresh post in that topic and archives it at the end.

```bash
SLAB_API_TOKEN=... SLAB_TEAM=... SLAB_TEST_TOPIC=... bun test test/integration/
```

## How It Works

Slabby implements the [Model Context Protocol](https://modelcontextprotocol.io), which allows AI assistants like Claude to interact with external tools and services. When you ask Claude Code to read or update Slab content, it:

1. Uses your Slab API token to authenticate (format: `Authorization: Bearer YOUR_TOKEN`)
2. Makes requests to the Slab GraphQL API at `https://api.slab.com/v1/graphql`
3. Converts Quill Delta content to Markdown for readability
4. Returns results to Claude Code

## Editing model

Slab stores post content in Quill Delta format. Slabby converts between Delta and Markdown so agents can read and write markdown, while the actual mutations sent to Slab are minimal Delta patches.

**Prefer `slab__edit_post`** for any partial change. It locates a unique substring and emits a tight `retain / delete / insert` patch that preserves all surrounding formatting and keeps the version history clean. `oldText` must be unique in the post and contained within a single formatting run (e.g. all-plain, all-bold, all-link); spans crossing formatting boundaries are rejected.

**`slab__update_post` is for full rewrites only.** It computes a minimal diff via the `quill-delta` library, but constructs not expressible in markdown (tables, custom embed attributes) are lost on a full update.

**`slab__sync_post`** creates or updates a read-only post mirroring an external source. Slab users cannot edit a synced post in-place.

`slab__delete_topic` is destructive and requires `confirm: true`. There is no `delete_post` — archive a post via `slab__set_post_state({archived: true})` instead.

## Security

- **API tokens are stored locally** - Never sent to Anthropic's servers
- **Markdown output** - Quill Delta content automatically converted to Markdown
- **Read-only by default** - Update operations require explicit permission
- **Environment-based config** - Tokens stored in `.env` (gitignored)

## Slab API Reference

This project uses the [Slab GraphQL API](https://api.slab.com/v1/graphql). The GraphQL schema is documented at:
https://studio.apollographql.com/public/Slab/variant/current/schema/reference

Key operations:
- `query GetPost` - Fetch post content by ID
- `mutation UpdatePostContent` - Update post content using Quill Delta format
- `query SearchPosts` - Search posts across workspace (cursor-based pagination)
- `query GetTopicPosts` - List posts in a specific topic
- `query GetOrganizationPosts` - List all posts in the organization

See [SCHEMA_VERIFICATION.md](SCHEMA_VERIFICATION.md) for detailed schema documentation.

## Troubleshooting

### "Authentication failed" error
- Check that your `SLAB_API_TOKEN` is correct
- Verify the token has appropriate permissions in Slab settings

### "Team not found" error
- Ensure `SLAB_TEAM` matches your Slab subdomain (e.g., "acme" for acme.slab.com)

### Claude Code doesn't see the tools
- Restart Claude Code after updating MCP config
- Check that the absolute path to `index.ts` is correct
- Verify bun is in your PATH

## Contributing

Contributions welcome! Please feel free to submit issues, fork the repository, and send pull requests.

When contributing, please:
1. Add tests for any new functionality
2. Ensure all tests pass with `bun test`
3. Follow the existing code style
4. Update documentation as needed

## License

Copyright 2025 Russ White

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this project except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

See the [LICENSE](LICENSE) file for the full license text.

## Related Projects

- [Model Context Protocol](https://modelcontextprotocol.io) - MCP specification
- [Claude Code](https://claude.com/code) - AI-powered development environment
- [Slab API](https://api.slab.com/) - Official Slab API documentation

---

Built with ❤️ using [Bun](https://bun.com) and the [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk)
