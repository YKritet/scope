#!/usr/bin/env bash
# scope installer — https://github.com/YKritet/scope
set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

step()  { printf "  ${CYAN}▸${RESET} %s" "$1"; }
ok()    { printf "\r  ${GREEN}✓${RESET} %s\n" "$1"; }
warn()  { printf "  ${YELLOW}!${RESET} %s\n" "$1"; }
fail()  { printf "  ${RED}✗${RESET} %s\n" "$1"; exit 1; }
info()  { printf "  ${DIM}%s${RESET}\n" "$1"; }

printf "\n"
printf "  ${CYAN}${BOLD}┌───────────────────────────────────────┐${RESET}\n"
printf "  ${CYAN}${BOLD}│${RESET}  ${BOLD}scope${RESET} — see every server on your machine  ${CYAN}${BOLD}│${RESET}\n"
printf "  ${CYAN}${BOLD}└───────────────────────────────────────┘${RESET}\n\n"

# ── 1. Node.js ──────────────────────────────────────────────────────────────

step "Checking Node.js..."
NODE_BIN=""
for candidate in node ~/.nvm/versions/node/*/bin/node /opt/homebrew/bin/node /usr/local/bin/node; do
  if command -v "$candidate" &>/dev/null 2>&1 || [[ -x "$candidate" ]]; then
    NODE_BIN=$(command -v "$candidate" 2>/dev/null || echo "$candidate")
    break
  fi
done

if [[ -z "$NODE_BIN" ]]; then
  warn "Node.js not found."
  printf "\n  Install it first:\n"
  printf "  ${CYAN}  brew install node${RESET}     (macOS)\n"
  printf "  ${CYAN}  apt install nodejs${RESET}    (Debian/Ubuntu)\n"
  printf "  ${CYAN}  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/HEAD/install.sh | bash${RESET}\n\n"
  exit 1
fi

NODE_VER=$("$NODE_BIN" --version 2>/dev/null)
ok "Node.js $NODE_VER"

# ── 2. Install ───────────────────────────────────────────────────────────────

NPM_BIN=$(dirname "$NODE_BIN")/npm

step "Installing @ykritet/scope..."
if "$NPM_BIN" install -g @ykritet/scope --silent 2>/dev/null; then
  ok "Installed via npm"
else
  warn "npm install failed — installing from GitHub..."
  step "Cloning and linking..."
  TMPDIR=$(mktemp -d)
  git clone --depth 1 https://github.com/YKritet/scope.git "$TMPDIR/scope" &>/dev/null
  cd "$TMPDIR/scope"
  "$NPM_BIN" install --production --silent &>/dev/null
  "$NPM_BIN" link --silent &>/dev/null
  ok "Installed from source"
fi

# ── 3. Shell detection ───────────────────────────────────────────────────────

step "Detecting shell..."
SHELL_NAME=$(basename "${SHELL:-bash}")
case "$SHELL_NAME" in
  zsh)   RC="$HOME/.zshrc" ;;
  bash)  RC="${BASH_ENV:-$HOME/.bashrc}" ;;
  fish)  RC="$HOME/.config/fish/config.fish" ;;
  *)     RC="$HOME/.profile" ;;
esac
ok "Shell: $SHELL_NAME ($RC)"

# ── 4. PATH + aliases ────────────────────────────────────────────────────────

SCOPE_BIN=$(command -v scope 2>/dev/null || "$NPM_BIN" bin -g 2>/dev/null)/scope
BLOCK_START="# >>> scope >>>"
BLOCK_END="# <<< scope <<<"

add_block() {
  local file="$1"
  # Remove old block if present
  if grep -q "$BLOCK_START" "$file" 2>/dev/null; then
    sed -i.bak "/$BLOCK_START/,/$BLOCK_END/d" "$file" 2>/dev/null || true
  fi

  if [[ "$SHELL_NAME" == "fish" ]]; then
    cat >> "$file" <<FISH

$BLOCK_START
alias st='scope tui'
alias sk='scope kill'
alias sp='scope'
$BLOCK_END
FISH
  else
    cat >> "$file" <<SH

$BLOCK_START
alias st='scope tui'     # interactive TUI
alias sk='scope kill'    # kill a port: sk 3000
alias sp='scope'         # static table
$BLOCK_END
SH
  fi
}

step "Adding aliases to $RC..."
add_block "$RC"
ok "Aliases added  (st, sk, sp)"

# ── 5. Shell completion (zsh only for now) ───────────────────────────────────

if [[ "$SHELL_NAME" == "zsh" ]]; then
  COMPLETION_DIR="${ZDOTDIR:-$HOME}/.zsh/completions"
  mkdir -p "$COMPLETION_DIR"
  cat > "$COMPLETION_DIR/_scope" <<'COMP'
#compdef scope
_scope() {
  local -a cmds
  cmds=('tui:interactive dashboard' 'kill:kill a port' 'ls:static table' '--json:JSON output' '--version:show version')
  _describe 'scope commands' cmds
}
_scope
COMP
  # ensure completions dir is on fpath
  if ! grep -q "$COMPLETION_DIR" "$RC" 2>/dev/null; then
    echo "fpath=($COMPLETION_DIR \$fpath)" >> "$RC"
  fi
  ok "Zsh completion installed"
fi

# ── 6. Summary ───────────────────────────────────────────────────────────────

printf "\n  ${GREEN}${BOLD}All done!${RESET}\n\n"
printf "  Reload your shell:\n"
printf "  ${CYAN}  source %s${RESET}\n\n" "$RC"
printf "  Commands:\n"
printf "  ${BOLD}  scope${RESET}         ${DIM}static table of all services${RESET}\n"
printf "  ${BOLD}  scope tui${RESET}     ${DIM}interactive TUI (j/k navigate, l logs, / search)${RESET}\n"
printf "  ${BOLD}  scope kill 3000${RESET}  ${DIM}kill whatever is on :3000${RESET}\n"
printf "  ${BOLD}  scope --json${RESET}  ${DIM}machine-readable output${RESET}\n"
printf "\n"
printf "  Aliases:\n"
printf "  ${CYAN}  st${RESET}  → scope tui\n"
printf "  ${CYAN}  sk${RESET}  → scope kill\n"
printf "  ${CYAN}  sp${RESET}  → scope\n"
printf "\n"
