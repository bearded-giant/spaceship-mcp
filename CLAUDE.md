# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Stdio MCP server for the Spaceship registrar API (domains, DNS, contacts, SellerHub). TypeScript, ESM, Node >= 20, pnpm. Fork of `BartWaardenburg/spaceship-mcp` (git remote `upstream`); not published to npm, so clients run `node dist/index.js` from a local checkout. The README's "Change from upstream" table lists every intentional divergence; add a row when you diverge again.

## Commands

```bash
pnpm install
pnpm build            # tsc -> dist/; a client running dist/ needs a rebuild and an MCP reconnect to see changes
pnpm typecheck
pnpm test             # vitest run, all src/**/*.test.ts
pnpm vitest run src/spaceship-client.test.ts -t "saveDnsRecords"   # one file / name filter
pnpm dev              # tsx src/index.ts; needs SPACESHIP_API_KEY and SPACESHIP_API_SECRET
```

CI (`.github/workflows/ci.yml`) runs `pnpm typecheck` and `pnpm test` on Node 20. `pnpm release` runs release-it: version bump, CHANGELOG, tag, push, GitHub release. npm publish is off (`.release-it.json`); a published GitHub release triggers `docker.yml`, which pushes the image to GHCR.

## Architecture

`index.ts` reads env vars, builds one `SpaceshipClient`, and passes it to `createServer` (`server.ts`) with the toolsets parsed from `SPACESHIP_TOOLSETS`.

`server.ts` maps each toolset to `register*Tools(server, client)` functions in `src/tools/`. A registerer runs at most once even when several toolsets share it (`contacts` and `privacy` are the same registerer; `availability` registers all of `domain-management.ts`). Prompts (`prompts.ts`) register regardless of toolsets.

Each tool file calls `server.registerTool(name, { inputSchema: z.object(...), annotations }, handler)`. Handlers normalize the domain with `normalizeDomain`, call one client method, and return `toTextResult(text, structuredContent?)` or `toErrorResult(error)` from `tool-result.ts`. `toErrorResult` turns a `SpaceshipApiError` (status + parsed body) into text with a recovery hint keyed on status. Tool descriptions and annotations (`destructiveHint` etc.) are what the calling model reads, so keep them accurate when behavior changes.

`spaceship-client.ts` owns all HTTP:

- `request`/`rawRequest` resolve credentials lazily on the first call (`credentials.ts`: `op://` values go through `op read`, memoized, retried after a failure), send `X-API-Key`/`X-API-Secret`, and retry 429s using `Retry-After` or 2^n seconds up to `maxRetries`.
- Only reads go through `cachedRequest` (an in-memory `TtlCache`); keys are prefixed `dns:`, `domain:`, `domains:all`, `contact:`, `sellerhub:all`. A write method must call `this.cache.invalidate(<prefix>)` (substring match) or later reads return stale data.
- `listAll*` methods page through `paginate` until `total` is reached.
- `saveDnsRecords` is the core DNS write and every `create_*_record` tool goes through it. It lists existing records, DELETEs every record matching an incoming name+type, then PUTs with `force: true`. If the PUT fails it re-PUTs the deleted records so a name never ends up empty. With `merge: true` (only `create_txt_record` passes it) existing values at that name+type are re-sent alongside the new one, skipping exact duplicates via `recordFingerprint`; every other creator replaces all records of its name+type.
- `buildRecordPayload` maps a `DnsRecord` to the API's per-type fields, including parsing a single `value` string for MX (`"pref exchange"`) and SRV (`"prio weight port target"` with a `_service._proto` name).
- Lifecycle calls (register, renew, restore, transfer) return the `spaceship-async-operationid` header; `get_async_operation` polls it.

## Conventions

- Relative imports end in `.js` (NodeNext). Zod is imported as `* as z from "zod/v4"`.
- Tests sit next to source as `*.test.ts` and are excluded from the tsc build. Client tests stub global `fetch` (`vi.stubGlobal`) and assert the exact request sequence. `tools/tools.test.ts` captures handlers through a fake `registerTool` and uses `createMockClient()`, a `vi.fn()` per client method; add the method there when a tool calls a new one. `credentials.test.ts` mocks `node:child_process` `execFile` rather than calling `op`.
- When adding or removing tools, update the README tool tables, the "48 tools" feature count, and the toolset table if a registerer moves.
