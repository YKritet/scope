# scope

**See every server running on your machine.**

Port, process, owner, working directory, git branch, worktree, memory, CPU, security flags — in a static table or a navigable terminal dashboard.

[![CI](https://github.com/YKritet/scope/actions/workflows/ci.yml/badge.svg)](https://github.com/YKritet/scope/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@ykritet/scope)](https://www.npmjs.com/package/@ykritet/scope)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

```
  scope   22 services   10 docker  3 node  1 python  1 ollama   ⟳ 2s

  PORT     PROCESS        USER            DIR                          BRANCH             FW         CPU    MEM       UPTIME    STATUS    SEC
  :3000    next-server    kritetyoussef   ~/mono/apps/frontend         feat/dev-roadmap   Next.js    0.0%   73 MB     11h 48m   ● listen  ok
  :3001    next-server    kritetyoussef   ~/mono/apps/frontend         feat/dev-roadmap   Next.js    0.0%   79 MB     11h 37m   ● listen  ok
  :3002    next-server    kritetyoussef   ~/mono-2/apps/frontend       feat/dark-mode     Next.js    0.0%   349 MB    1h 14m    ● listen  ok
  :5432    docker         —               ~/projects/backend            —                  Docker     —      —         13d 7h    ● run     ok
  :8000    Python         kritetyoussef   ~/projects/api                develop            FastAPI    0.0%   10 MB     3h 24m    ● listen  ok
  :9000    node           root            ~/risky-app                   main               Express    1.2%   45 MB     2h 00m    ● listen  root pub
```

---

## Install

### One-liner (recommended)

```sh
curl -fsSL https://raw.githubusercontent.com/YKritet/scope/main/install.sh | bash
```

The installer:
- Checks for Node.js (guides you to install it if missing)
- Installs `scope` globally via npm
- Detects your shell (zsh, bash, fish)
- Adds aliases to your shell config
- Installs zsh tab-completion

### npm

```sh
npm install -g @ykritet/scope
```

### npx (no install)

```sh
npx @ykritet/scope tui
```

### Aliases added by the installer

| Alias | Expands to |
|-------|-----------|
| `st`  | `scope tui` |
| `sk`  | `scope kill` |
| `sp`  | `scope` |

---

## Usage

```sh
scope                  # static table — all services at a glance
scope tui              # interactive TUI
scope 3000             # inspect port 3000 in detail
scope kill 3000        # kill whatever is on :3000 (SIGTERM)
scope kill 3000 -f     # force kill (SIGKILL)
scope --json           # machine-readable JSON (pipe to jq, etc.)
scope --version
```

### TUI keyboard shortcuts

| Key | Action |
|-----|--------|
| `j` / `k` / `↑` `↓` | Navigate services |
| `l` | Toggle log panel — tails stdout/stderr live |
| `K` | Kill selected process (SIGTERM) |
| `o` | Open `http://localhost:<port>` in browser |
| `t` | Create ticket for selected service (GitHub Issue or local file) |
| `/` | Search and filter by port, name, branch, framework, user |
| `r` | Force refresh |
| `tab` | Switch focus between list and detail panel |
| `q` / `Ctrl-C` | Quit |

---

## What it shows

| Column | Source | Notes |
|--------|--------|-------|
| **PORT** | `lsof -iTCP:LISTEN` | Listening port number |
| **PROCESS** | `ps` | Process name or Docker service |
| **USER** | `ps -o user=` | OS user who owns the process |
| **DIR** | `lsof -d cwd` + `git worktree list` | Working directory, home-abbreviated |
| **BRANCH** | `git worktree list --porcelain` | Current branch; yellow = linked worktree |
| **FRAMEWORK** | `package.json` deps + command inspection | Next.js, FastAPI, Vite, Django, Rust, etc. |
| **CPU** | `ps -o pcpu=` | Color-coded: green / yellow / red |
| **MEM** | `ps -o rss=` | Resident memory |
| **UPTIME** | `ps -o lstart=` | Time since process started |
| **STATUS** | `ps -o stat=` | listening / running / orphaned / zombie |
| **SEC** | bind address + user check | `pub` = exposed on all interfaces, `root` = running as root |

Docker containers show compose project, service, workdir, port mapping, and key environment variables (`NODE_ENV`, `DATABASE_URL`, etc.) in the detail panel.

---

## Security flags

scope highlights two classes of risk in the **SEC** column:

| Flag | Meaning |
|------|---------|
| `pub` | Service is bound to `0.0.0.0` — reachable from the local network, not just localhost |
| `root` | Process is running as root — elevated privileges |
| `zombie` | Process is in zombie state — parent not collecting exit status |
| `orphan` | Dev process with PPID 1 — likely left over from a crashed session |

---

## Ticket integration

Every prompt you type in Claude Code automatically creates a ticket in the current project's tracking system (wired via `UserPromptSubmit` hook):

- **GitHub remote present** → `gh issue create`
- **`.claude/jira.env` present** → Jira REST API
- **Fallback** → `<project>/.claude/tickets/YYYY-MM-DD-NNNN-slug.md`

In the TUI, press `t` on any service to open an issue for it directly.

---

## JSON output

```sh
scope --json | jq '.[] | select(.framework == "Next.js") | {port, branch, memory}'
```

```json
[
  {
    "port": 3000,
    "processName": "next-server",
    "user": "kritetyoussef",
    "cwd": "/Users/kritetyoussef/projects/mono/apps/frontend",
    "branch": "feat/dev-roadmap",
    "isLinkedWorktree": true,
    "mainPath": "/Users/kritetyoussef/projects/mono",
    "framework": "Next.js",
    "cpu": 0.0,
    "memory": "73.3 MB",
    "uptime": "11h 48m",
    "status": "listening",
    "bindScope": "local",
    "rootProcess": false,
    "source": "process"
  }
]
```

---

## Requirements

- **macOS** or **Linux** (Windows via Git Bash / WSL)
- **Node.js** >= 18
- `lsof` (pre-installed on macOS; `apt install lsof` on Linux)
- **Docker** — optional, detected automatically
- **git** — optional, for branch and worktree detection
- **gh** — optional, for ticket creation via GitHub Issues

---

## How it works

Three shell calls, typically completes in under 300 ms:

1. `lsof -iTCP -sTCP:LISTEN` — finds all listening TCP sockets with bind address
2. `ps` (single batched call) — PID, CPU, memory, user, uptime, command
3. `lsof -d cwd` (single batched call) — working directory per PID
4. `git worktree list --porcelain` — branch + linked worktree detection (cached 10 s per CWD)
5. `docker inspect` (single call) — port bindings, compose labels, env vars

---

## License

MIT
