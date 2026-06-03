# scope

> **What is this?**
> When you're a developer, you often have many programs running at once — web servers, databases, background workers — and it gets confusing. scope shows you everything that's running, where it came from, and how much it's using, in a clean terminal view.

[![CI](https://github.com/YKritet/scope/actions/workflows/ci.yml/badge.svg)](https://github.com/YKritet/scope/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@ykritet/scope)](https://www.npmjs.com/package/@ykritet/scope)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## Install in 30 seconds

Paste this into your terminal and press Enter:

```sh
curl -fsSL https://raw.githubusercontent.com/YKritet/scope/main/install.sh | bash
```

Then reload your terminal:

```sh
source ~/.zshrc   # or source ~/.bashrc on Linux
```

That's it. You're done.

> **Need Node.js first?** The installer will tell you if it's missing and show you exactly how to get it. Or go to [nodejs.org](https://nodejs.org) and click the big green button.

---

## Use it

After installing, you have three ways to use scope:

**1. Quick view** — shows a table of everything running right now
```sh
scope
# or the short alias:
sp
```

**2. Interactive dashboard** — navigate with arrow keys, see details, stream logs
```sh
scope tui
# or the short alias:
st
```

**3. Kill a port** — stop whatever is running on a specific port
```sh
scope kill 3000
# or the short alias:
sk 3000
```

---

## What you'll see

```
  PORT     PROCESS        USER            WHERE                        BRANCH             USES       CPU    MEMORY    UP        STATUS
  :3000    next-server    alice           ~/projects/my-app            feat/new-login     Next.js    0%     73 MB     11h       running
  :3001    next-server    alice           ~/projects/my-app            main               Next.js    0%     79 MB     3h        running
  :5432    docker         —               ~/projects/backend            —                  PostgreSQL  —      —         13 days   running
  :8000    Python         alice           ~/projects/api                develop            FastAPI    0%     10 MB     3h        running
```

Each row tells you:
- **PORT** — the number programs use to talk to each other (`:3000`, `:5432`, etc.)
- **PROCESS** — what program is running there
- **USER** — who started it
- **WHERE** — which folder on your computer it came from
- **BRANCH** — which git branch it's on (handy when you have multiple versions running)
- **USES** — what framework or tool it is (Next.js, FastAPI, PostgreSQL, etc.)
- **CPU / MEMORY** — how much of your computer it's using
- **UP** — how long it's been running
- **STATUS** — is it healthy, or is something wrong?

---

## Interactive dashboard keys

Open it with `st` or `scope tui`, then:

| Key | What it does |
|-----|-------------|
| `↑` `↓` or `j` `k` | Move up and down the list |
| `Enter` | See full details for the selected item |
| `l` | Show live logs (what the program is printing right now) |
| `K` | Stop the selected program |
| `o` | Open it in your web browser |
| `t` | Create a ticket/issue for it |
| `/` | Search — type to filter by name, port, folder, or branch |
| `r` | Refresh the list now |
| `q` | Quit |

---

## Other ways to install

**npm** (if you already have Node.js):
```sh
npm install -g @ykritet/scope
```

**pnpm**:
```sh
pnpm add -g @ykritet/scope
```

**bun**:
```sh
bun add -g @ykritet/scope
```

**Try without installing** (uses npx):
```sh
npx @ykritet/scope tui
```

---

## For power users

**Get data as JSON** (pipe to other tools):
```sh
scope --json
scope --json | jq '.[] | select(.framework == "Next.js")'
scope --json | jq '.[] | select(.bindScope == "public")' # find publicly exposed services
```

**Security flags** — scope highlights potential issues in the SEC column:

| Flag | What it means |
|------|--------------|
| `pub` | This service is reachable from other devices on your network (bound to 0.0.0.0). Probably fine locally, but worth knowing. |
| `root` | This process is running with administrator privileges. Be careful. |
| `zombie` | The process is stuck and not responding properly. |
| `orphan` | The process was left running after something crashed. |

**Docker** — scope automatically shows Docker containers alongside regular processes, including the compose project name, service, and key environment variables.

**Git worktrees** — if you use `git worktree` to work on multiple branches simultaneously, scope shows which worktree each process came from (highlighted in yellow).

---

## Requirements

- **macOS** or **Linux** — Windows works via Git Bash or WSL
- **Node.js 18 or newer** — the installer will guide you if it's missing
- **Docker** — optional, detected automatically if running
- **git** — optional, for branch and worktree info

---

## How it works

scope runs three fast system commands and merges the results:

1. `lsof -iTCP:LISTEN` — finds every program listening for network connections
2. `ps` — gets the details for each program (who started it, memory, CPU)
3. `docker inspect` — gets info about Docker containers (if Docker is running)

It also checks the working directory of each process and runs `git worktree list` to figure out which branch and folder it came from.

The whole scan typically takes under 300ms.

---

## Uninstall

```sh
npm uninstall -g @ykritet/scope
```

This also removes the `scope`, `st`, `sk`, `sp` commands. To remove the aliases from your shell config, delete the `# >>> scope >>>` block from `~/.zshrc` (or `~/.bashrc`).

---

## License

MIT — free to use, modify, and share.
