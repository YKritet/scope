#!/usr/bin/env bash
# scope installer — https://github.com/YKritet/scope
set -euo pipefail

# ── Colors ───────────────────────────────────────────────────────────────────
CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
RED='\033[0;31m'; BOLD='\033[1m'; DIM='\033[2m'; RESET='\033[0m'

# Disable colors when not in a terminal
if [[ ! -t 1 ]]; then
  CYAN=''; GREEN=''; YELLOW=''; RED=''; BOLD=''; DIM=''; RESET=''
fi

p()    { printf '%b\n' "$*"; }   # print with color escapes
step() { printf '  %b▸%b  %s' "$CYAN" "$RESET" "$1"; }
ok()   { printf '\r  %b✓%b  %s\n' "$GREEN" "$RESET" "$1"; }
warn() { p "  ${YELLOW}!${RESET}  $1"; }
fail() { p "  ${RED}✗${RESET}  $1"; exit 1; }

p ""
p "  ${CYAN}${BOLD}┌────────────────────────────────────────┐${RESET}"
p "  ${CYAN}${BOLD}│${RESET}  ${BOLD}scope${RESET} — see every server on your machine  ${CYAN}${BOLD}│${RESET}"
p "  ${CYAN}${BOLD}└────────────────────────────────────────┘${RESET}"
p ""
p "  This will install ${BOLD}scope${RESET} and add shortcuts to your terminal."
p "  Takes about 30 seconds. You can always uninstall with: ${CYAN}npm uninstall -g @ykritet/scope${RESET}"
p ""

# ── 1. Find Node.js ──────────────────────────────────────────────────────────
step "Looking for Node.js..."
NODE_BIN=""
for candidate in \
  "$(command -v node 2>/dev/null || true)" \
  "$HOME/.nvm/versions/node/v22.0.0/bin/node" \
  "$HOME/.nvm/versions/node/v20.0.0/bin/node" \
  /opt/homebrew/bin/node \
  /usr/local/bin/node \
  /usr/bin/node; do
  if [[ -x "$candidate" ]]; then NODE_BIN="$candidate"; break; fi
done

# Also try the latest nvm version
if [[ -z "$NODE_BIN" && -d "$HOME/.nvm/versions/node" ]]; then
  NODE_BIN=$(ls -t "$HOME/.nvm/versions/node"/*/bin/node 2>/dev/null | head -1 || true)
fi

if [[ -z "$NODE_BIN" ]]; then
  ok "Node.js not found"
  p ""
  p "  ${YELLOW}scope needs Node.js to run.${RESET} Install it first:"
  p ""
  p "  ${BOLD}macOS:${RESET}   ${CYAN}brew install node${RESET}"
  p "  ${BOLD}Ubuntu:${RESET}  ${CYAN}apt install nodejs npm${RESET}"
  p "  ${BOLD}Any:${RESET}     ${CYAN}https://nodejs.org${RESET}  (click the big green button)"
  p ""
  p "  Then re-run this installer."
  exit 1
fi

NODE_VER=$("$NODE_BIN" --version 2>/dev/null)
ok "Found Node.js $NODE_VER"

# ── 2. Find a package manager (npm / pnpm / bun) ─────────────────────────────
step "Finding a package manager..."
NODE_DIR=$(dirname "$NODE_BIN")
PKG_BIN=""
PKG_NAME=""

for pm in "$NODE_DIR/pnpm" "$NODE_DIR/bun" "$NODE_DIR/npm" \
          "$(command -v pnpm 2>/dev/null || true)" \
          "$(command -v bun  2>/dev/null || true)" \
          "$(command -v npm  2>/dev/null || true)"; do
  if [[ -x "$pm" ]]; then
    PKG_BIN="$pm"
    PKG_NAME=$(basename "$pm")
    break
  fi
done

[[ -z "$PKG_BIN" ]] && fail "No package manager found. Install npm, pnpm, or bun."
ok "Using $PKG_NAME"

# ── 3. Install scope ──────────────────────────────────────────────────────────
step "Installing scope (this takes ~10 seconds)..."
INSTALL_OK=false

case "$PKG_NAME" in
  pnpm) "$PKG_BIN" add -g @ykritet/scope --silent 2>/dev/null && INSTALL_OK=true ;;
  bun)  "$PKG_BIN" add -g @ykritet/scope          2>/dev/null && INSTALL_OK=true ;;
  npm)  "$PKG_BIN" install -g @ykritet/scope --silent 2>/dev/null && INSTALL_OK=true ;;
esac

if [[ "$INSTALL_OK" != "true" ]]; then
  warn "Package registry install failed. Trying GitHub source..."
  TMPDIR=$(mktemp -d)
  trap 'rm -rf "$TMPDIR"' EXIT
  git clone --depth 1 https://github.com/YKritet/scope.git "$TMPDIR/scope" &>/dev/null \
    || fail "Could not download scope. Check your internet connection and try again."
  cd "$TMPDIR/scope"
  npm install --production --silent &>/dev/null
  npm link --silent &>/dev/null
  INSTALL_OK=true
fi

ok "scope installed"

# ── 4. Detect shell and config file ───────────────────────────────────────────
step "Detecting your shell..."
SHELL_NAME=$(basename "${SHELL:-bash}")
case "$SHELL_NAME" in
  zsh)  RC="$HOME/.zshrc" ;;
  bash) RC="${BASH_ENV:-$HOME/.bashrc}" ;;
  fish) RC="$HOME/.config/fish/config.fish" ;;
  *)    RC="$HOME/.profile" ;;
esac
ok "Shell: $SHELL_NAME"

# ── 5. Add aliases ────────────────────────────────────────────────────────────
step "Adding shortcuts to $RC..."
MARK_START="# >>> scope >>>"
MARK_END="# <<< scope <<<"

# Remove old block first (idempotent installs)
if grep -q "$MARK_START" "$RC" 2>/dev/null; then
  if [[ "$(uname -s)" == "Darwin" ]]; then
    sed -i '' "/$MARK_START/,/$MARK_END/d" "$RC"
  else
    sed -i "/$MARK_START/,/$MARK_END/d" "$RC"
  fi
fi

if [[ "$SHELL_NAME" == "fish" ]]; then
  printf '\n%s\nalias st="scope tui"\nalias sk="scope kill"\nalias sp="scope"\n%s\n' \
    "$MARK_START" "$MARK_END" >> "$RC"
else
  printf '\n%s\nalias st="scope tui"   # open the interactive dashboard\nalias sk="scope kill"  # kill a port: sk 3000\nalias sp="scope"       # quick table view\n%s\n' \
    "$MARK_START" "$MARK_END" >> "$RC"
fi
ok "Shortcuts added  (st, sk, sp)"

# ── 6. Zsh tab-completion ─────────────────────────────────────────────────────
if [[ "$SHELL_NAME" == "zsh" ]]; then
  step "Installing tab-completion..."
  COMP_DIR="${ZDOTDIR:-$HOME}/.zsh/completions"
  mkdir -p "$COMP_DIR"
  cat > "$COMP_DIR/_scope" << 'COMP'
#compdef scope
_scope_commands=(
  'tui:open the interactive dashboard'
  'kill:kill a process by port number'
  '--json:print everything as JSON'
  '--version:show version number'
)
_describe 'scope command' _scope_commands
COMP
  if ! grep -q "$COMP_DIR" "$RC" 2>/dev/null; then
    printf '\nfpath=(%s $fpath)\nautoload -Uz compinit && compinit\n' "$COMP_DIR" >> "$RC"
  fi
  ok "Tab-completion installed"
fi

# ── 7. Done ───────────────────────────────────────────────────────────────────
p ""
p "  ${GREEN}${BOLD}All done!${RESET} scope is installed."
p ""
p "  ${BOLD}Step 1:${RESET} Reload your terminal shortcuts:"
p "  ${CYAN}    source $RC${RESET}"
p ""
p "  ${BOLD}Step 2:${RESET} Try it:"
p "  ${CYAN}    st${RESET}        ${DIM}← opens the interactive dashboard${RESET}"
p "  ${CYAN}    scope${RESET}     ${DIM}← quick table of everything running${RESET}"
p ""
p "  ${DIM}Other commands:${RESET}"
p "  ${CYAN}    sk 3000${RESET}   ${DIM}← stop whatever is on port 3000${RESET}"
p "  ${CYAN}    scope --json | jq${RESET}  ${DIM}← get data in JSON${RESET}"
p ""
p "  ${DIM}Uninstall anytime: npm uninstall -g @ykritet/scope${RESET}"
p ""
