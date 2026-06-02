# scope

See every server running on your machine -- port, process, folder, git branch, user, memory, logs.

```
  scope   22 services   10 docker  3 node  1 python  1 ollama   ⟳ 2s

  PORT     PROCESS        USER            DIR                                BRANCH             FRAMEWORK  CPU    MEM       UPTIME    STATUS
  :3000    next-server    kritetyoussef   ~/projects/mono/apps/frontend      feat/dev-roadmap   Next.js    0.0%   73 MB     11h 48m   ● listening
  :3001    next-server    kritetyoussef   ~/projects/mono/apps/frontend      feat/dev-roadmap   Next.js    0.0%   79 MB     11h 37m   ● listening
  :3002    next-server    kritetyoussef   ~/projects/mono-2/apps/frontend    feat/dark-mode     Next.js    0.0%   349 MB    1h 14m    ● listening
  :5432    docker         —               ~/projects/backend                 —                  Docker     —      —         13d 7h    ● running
  :8000    Python         kritetyoussef   ~/projects/api                     develop            FastAPI    0.0%   10 MB     3h 24m    ● listening
  :11434   ollama         kritetyoussef   /opt/homebrew/var                  stable             —          0.0%   15 MB     28d 13h   ● listening
```

## Install

### Homebrew (recommended)

```sh
brew tap YKritet/scope
brew install scope
```

### npm

```sh
npm install -g @ykritet/scope
```

### npx (no install)

```sh
npx @ykritet/scope
```

## Usage

```sh
scope              # static table — all services at a glance
scope tui          # interactive TUI (navigate, logs, kill, search)
scope 3000         # inspect a single port in detail
scope --version
```

### TUI keys

| Key | Action |
|-----|--------|
| `j` / `k` or arrows | Navigate |
| `l` | Toggle log panel (tails stdout/stderr) |
| `K` | Kill selected process |
| `o` | Open in browser |
| `/` | Search / filter |
| `r` | Force refresh |
| `q` | Quit |

## What it shows

- **PORT** — listening port number
- **PROCESS** — process name or Docker service name
- **USER** — OS user who owns the process
- **DIR** — working directory (abbreviated)
- **BRANCH** — current git branch; yellow if inside a linked worktree
- **FRAMEWORK** — detected framework (Next.js, FastAPI, Vite, Django, Rust, etc.)
- **CPU** — CPU % (color-coded green / yellow / red)
- **MEM** — resident memory
- **UPTIME** — time since process started
- **STATUS** — listening / running / orphaned / zombie

Docker containers show compose project, service, workdir, and key env vars in the detail panel.

## Requirements

- macOS or Linux
- Node.js >= 18
- Docker (optional — detected automatically)

## License

MIT
