#!/usr/bin/env bash
# scripts/setup.sh — First-time project setup
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()    { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

info "FinBridge MCP Server — Setup"

# ── Node version check ────────────────────────────────────────────────────────
REQUIRED_NODE=20
CURRENT_NODE=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [[ "$CURRENT_NODE" -lt "$REQUIRED_NODE" ]]; then
  error "Node.js ${REQUIRED_NODE}+ required (found v${CURRENT_NODE}). Install via nvm: nvm install 20"
fi
info "Node.js version: $(node -v) ✅"

# ── Install dependencies ──────────────────────────────────────────────────────
info "Installing dependencies…"
npm install
info "Dependencies installed ✅"

# ── Environment file ──────────────────────────────────────────────────────────
if [[ ! -f .env ]]; then
  cp .env.example .env
  warn ".env created from .env.example — fill in your real credentials before starting"
else
  info ".env already exists — skipping"
fi

# ── Create logs directory ─────────────────────────────────────────────────────
mkdir -p logs
info "logs/ directory ready ✅"

# ── Generate secrets if not set ───────────────────────────────────────────────
if grep -q 'change_me_to_a_very_long_random_secret' .env 2>/dev/null; then
  JWT_SECRET=$(openssl rand -hex 32)
  API_SALT=$(openssl rand -hex 8)
  sed -i.bak "s/change_me_to_a_very_long_random_secret_at_least_32_chars/${JWT_SECRET}/" .env
  sed -i.bak "s/change_me_to_a_16_char_salt_value/${API_SALT}/" .env
  rm -f .env.bak
  info "JWT_SECRET and API_KEY_SALT auto-generated ✅"
fi

# ── TypeScript type check ─────────────────────────────────────────────────────
info "Running TypeScript type check…"
npm run typecheck && info "TypeScript OK ✅" || warn "TypeScript errors found — fix before deploying"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
info "Setup complete! Next steps:"
echo "  1. Edit .env with your MySQL and Redis credentials"
echo "  2. Start dependencies:  npm run docker:up"
echo "  3. Start dev server:    npm run dev"
echo "  4. API docs:            http://localhost:3000/docs"
echo "  5. MCP SSE endpoint:    http://localhost:3000/mcp/sse"
echo ""
