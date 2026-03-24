# EXECUTIONOR v1.1
**Agent Control Board — Stay Visual · Stay Free · Stay Opensource · Stay Executionor**

A production-grade AI agent control board that runs locally on your Windows machine.
Real PowerShell execution. Real filesystem. Real Supabase. Real Claude agents.

---

## Quick Start

```powershell
cd D:\tools\executionor
.\start.ps1
```

Then open: **http://localhost:3100**

---

## First Run

On first launch, a setup wizard will appear asking for your Anthropic API key.
Alternatively, click **⚙ Settings** in the sidebar to configure all keys at runtime.
Keys are written to `.env` and hot-loaded — no server restart needed.

---

## Required Keys

| Key | Where to find it | Required for |
|-----|-----------------|--------------|
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/keys | All 5 agents |
| `SUPABASE_URL` | Supabase → Project Settings → API | DB panel |
| `SUPABASE_SERVICE_KEY` | Supabase → Project Settings → API | DB panel |
| `SUPABASE_DB_URL` | Supabase → Settings → Database → Connection string URI | Raw SQL support |

---

## Architecture

```
D:\tools\executionor\
├── server.js              ← Express + WebSocket server (port 3100)
├── .env                   ← Your config (edit via Settings UI)
├── start.ps1              ← Launcher script
│
├── routes/
│   ├── ps.js              ← Real PowerShell via child_process.spawn
│   ├── fs.js              ← Real filesystem (readdir/readFile/writeFile)
│   ├── db.js              ← Supabase JS client + pg driver for raw SQL
│   ├── agents.js          ← Claude API dispatch with auto-execution
│   ├── openclaw.js        ← OpenClaw relay + bridge proxy
│   ├── config.js          ← Live .env read/write (Settings UI backend)
│   └── sessions.js        ← Session persistence to disk (sessions/*.json)
│
├── services/
│   └── ws-manager.js      ← WebSocket broadcast for PS streaming
│
└── public/
    └── index.html         ← Full Claude Desktop-styled frontend
```

---

## API Reference

### PowerShell
- `POST /api/ps/exec` `{ command, sync? }` — execute, streams via WebSocket
- `GET  /api/ps/running` — list active processes
- `POST /api/ps/kill/:sessionId` — kill a specific process
- `POST /api/ps/killall` — kill everything
- `GET  /api/ps/history` — last 50 commands

### Filesystem
- `GET  /api/fs/list?path=D:\tools` — list directory
- `GET  /api/fs/read?path=D:\file.ps1` — read file content
- `POST /api/fs/write` `{ path, content }` — write file
- `DELETE /api/fs/delete?path=...` — delete file

### Database (Supabase)
- `POST /api/db/select` `{ table|sql, filters?, limit?, orderBy? }` — query
- `POST /api/db/query`  `{ sql }` — raw SQL (requires SUPABASE_DB_URL)
- `GET  /api/db/tables` — list tables
- `GET  /api/db/schema?table=name` — column schema

### Agents
- `POST /api/agents/dispatch` `{ agentId, command, history? }` — dispatch
- `GET  /api/agents/list` — list agent definitions

### Config
- `GET  /api/config` — key status (no values exposed)
- `POST /api/config` `{ key, value }` — write single key
- `POST /api/config/bulk` `{ pairs: { KEY: VALUE } }` — write multiple keys

### Sessions
- `GET  /api/sessions` — list saved sessions
- `GET  /api/sessions/:id` — load session
- `POST /api/sessions` `{ sessionId, messages, title }` — save
- `DELETE /api/sessions/:id` — delete

### Health
- `GET  /api/health` — server status + key presence check

---

## The 5 Agents

| Agent | Target | Behavior |
|-------|--------|---------|
| **SHELL** | PowerShell | Translates natural language → PowerShell, executes via `/api/ps/exec` |
| **PHANTOM** | Filesystem | Opens files in editor, browses directories |
| **HYDRA** | Supabase | Writes SQL queries, routes to `/api/db/select` |
| **SCRIBE** | Code Gen | Generates code, opens result in editor as new tab |
| **CLAW** | OpenClaw | Interfaces with your OpenClaw relay on port 4588 |

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `F5` | Run current editor content |
| `Ctrl+Enter` | Run (inside editor) |
| `Ctrl+S` | Download/export current file |
| `↑ / ↓` in PS terminal | Command history |
| `Enter` in dispatch bar | Send to selected agent |
| `Shift+Enter` | New line in dispatch bar |
| `Escape` | Close Settings/Wizard modal |

---

## WebSocket Events

Events emitted to all connected browsers:

```
ps:start     { sessionId, command }
ps:line      { sessionId, line, stream: 'stdout'|'stderr' }
ps:done      { sessionId, exitCode }
ps:timeout   { sessionId }
ps:killed    { sessionId }
ps:killall   { count }
agent:thinking  { agentId, command }
agent:response  { agentId, parsed, executionResult }
agent:error     { agentId, error }
```

---

## OpenClaw Integration

The gateway stack is expected on these ports (started by `start-claude-remote.ps1`):

| Service | Port | Purpose |
|---------|------|---------|
| OpenClaw Relay | 4588 | Core relay station |
| OpenClaw Bridge | 3004 | MCP bridge |
| DC OAuth | 3001 | Desktop Commander auth |
| MCP Proxy | 3002 | ngrok-exposed endpoint |
| Aggregator | 3003 | All-tools aggregator |
| **EXECUTIONOR** | **3100** | This app |

---

## License
Stay Visual · Stay Free · Stay Opensource · Stay Executionor
