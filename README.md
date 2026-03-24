# EXECUTIONOR AI

**Advanced local agent operations control plane**

Executionor is a local-first operator dashboard for running, monitoring, approving, and auditing agent workflows from one interface. It combines live shell execution, filesystem access, database tools, OpenClaw integration, real-time telemetry, and an Ops workspace with reusable runbooks plus persistent governance policies.

## What it does

- Runs real host-shell commands through the dashboard with streaming output
- Browses and edits the local workspace
- Connects to Supabase and optional raw PostgreSQL access
- Dispatches work through local agent roles
- Tracks Ops tasks with approvals, audit history, diagnostics, and reruns
- Saves reusable runbooks so common workflows can be queued without rewriting prompts
- Applies persistent governance policies for approval rules, blocked action types, and runbook controls
- Streams updates over WebSocket so multiple views stay in sync

## Quick start

```bash
npm install
npm start
```

Then open `http://localhost:3100`

On Windows you can still use `start.ps1` if that matches your environment.

## Required environment

Executionor runs locally with optional integrations. Core UI features work without every service being configured, but these unlock the full surface:

| Key | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude-backed agent dispatch |
| `SUPABASE_URL` | Supabase browser/API access |
| `SUPABASE_SERVICE_KEY` or `SUPABASE_ANON_KEY` | Supabase queries |
| `SUPABASE_DB_URL` or `DATABASE_URL` | Raw SQL tasks |
| `OPENCLAW_RELAY_URL` | OpenClaw relay health and actions |
| `OPENCLAW_BRIDGE_URL` | OpenClaw bridge health and tool calls |
| `OPENCLAW_GATEWAY_TOKEN` | Optional OpenClaw auth |
| `DASHBOARD_TOKEN` | Optional dashboard hardening |

## Core architecture

```text
server.js                 Express + WebSocket entrypoint
routes/                   API routes for shell, fs, db, agents, logs, monitor, ops
services/local-agent.js   Natural-language task routing into executable actions
services/ops-control.js   Ops tasks, approvals, audit, diagnostics, runbooks
services/host-runtime.js  Host-aware shell/runtime abstraction
public/                   Static dashboard UI
sessions/                 Persistent local state, including ops-control.json
```

## Ops control plane

The Ops workspace is the current high-value core of the app.

It supports:

- task creation from natural-language instructions
- approval-gated execution for non-low-risk actions
- audit trails for creation, approval, rejection, execution, and failures
- diagnostics for runtime, docs parity, MCP installs, OpenClaw reachability, and git state
- reusable runbooks that can be loaded into the form or queued directly as new tasks
- persistent governance policies that control which task types are blocked and which always require human approval

Built-in runbooks include workspace inventory, host runtime snapshot, OpenClaw status, and database schema snapshot.

## Copilot skills

Repository-local Copilot skills live under `.github/skills/`.

Create a new skill with:

```bash
npm run skill:new -- <skill-name>
```

Useful flags:

```bash
npm run skill:new -- <skill-name> --dry-run
npm run skill:new -- <skill-name> --force
```

## API reference

### Health

- `GET /api/health` — status, workspace root, host runtime, configured integrations

### Shell execution

- `POST /api/ps/exec` `{ command, sync? }` — execute through the current host shell
- `GET /api/ps/running` — list active shell sessions
- `POST /api/ps/kill/:sessionId` — kill one active session
- `POST /api/ps/killall` — stop all active sessions
- `GET /api/ps/history` — recent command history

### Filesystem

- `GET /api/fs/list?path=...`
- `GET /api/fs/read?path=...`
- `POST /api/fs/write` `{ path, content }`
- `DELETE /api/fs/delete?path=...`

### Database

- `POST /api/db/select`
- `POST /api/db/query`
- `GET /api/db/tables`
- `GET /api/db/schema?table=name`

### Agents

- `POST /api/agents/dispatch`
- `GET /api/agents/list`

### Config

- `GET /api/config`
- `POST /api/config`
- `POST /api/config/bulk`

### Sessions

- `GET /api/sessions`
- `GET /api/sessions/:id`
- `POST /api/sessions`
- `DELETE /api/sessions/:id`

### Logs and monitoring

- `GET /api/logs/files`
- `GET /api/logs/stream?path=...&tail=80`
- `GET /api/monitor/system`
- `GET /api/monitor/processes`
- `POST /api/monitor/kill`

### Ops

- `GET /api/ops/overview`
- `GET /api/ops/tasks`
- `POST /api/ops/tasks`
- `POST /api/ops/tasks/:id/approve`
- `POST /api/ops/tasks/:id/reject`
- `POST /api/ops/tasks/:id/run`
- `GET /api/ops/runbooks`
- `POST /api/ops/runbooks`
- `POST /api/ops/runbooks/:id/instantiate`
- `DELETE /api/ops/runbooks/:id`
- `GET /api/ops/policies`
- `PUT /api/ops/policies`
- `GET /api/ops/audit`
- `GET /api/ops/diagnostics`

## Runtime notes

- The app now adapts core shell, monitor, and log routes to the host runtime instead of assuming Windows-only execution.
- Some legacy UI copy still reflects the original Windows-first design.
- Ops filesystem actions are constrained to the workspace root for safety.
- Approval-gated tasks require fresh approval before rerun.
- Ops policies are persisted locally and can override operator form choices when governance rules require approval.

## Repository goal

Executionor is being built toward a more advanced operator experience than a basic local dashboard: repeatable workflows, tighter governance, better runtime visibility, and fewer context-wasting manual steps.
