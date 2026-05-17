# Setup Guide for FinBridge AI

> **Complete step-by-step guide to get FinBridge AI running on your machine**

---

## Prerequisites

Before starting, ensure you have:

- **Node.js** ≥ 20.0.0 — [Download](https://nodejs.org/)
  ```bash
  node --version  # Should be v20.x.x or higher
  ```

- **Docker & Docker Compose** — [Download](https://www.docker.com/products/docker-desktop)
  ```bash
  docker --version
  docker compose --version
  ```

- **Git** — [Download](https://git-scm.com/)
  ```bash
  git --version
  ```

- **OpenAI API Key** (optional, for AI features) — [Get one](https://platform.openai.com/api-keys)

---

## Step 1: Clone & Install

```bash
# Clone the repository
git clone https://github.com/your-org/finbridge-mcp.git
cd finbridge-mcp

# Install dependencies
npm install

# Verify installation
npm run typecheck
```

**Expected output**: No TypeScript errors

---

## Step 2: Environment Setup

### Option A: Automatic Setup (Recommended)

```bash
# Run the setup script
bash scripts/setup.sh
```

This will:
- Generate a 32-character JWT secret
- Generate an API key salt
- Create `.env` file with safe defaults
- Prompt for database credentials

### Option B: Manual Setup

```bash
# Copy the example file
cp .env.example .env

# Edit with your values
nano .env
```

Update these critical fields:

```env
# Database (required)
DB_HOST=localhost
DB_PORT=3306
DB_NAME=finbridge_db
DB_USER=readonly_user
DB_PASSWORD=your_secure_password

# JWT (generate with: openssl rand -hex 32)
JWT_SECRET=your_32_char_secret_here

# API Key Salt (generate with: openssl rand -hex 16)
API_KEY_SALT=your_16_char_salt_here

# Redis (defaults to localhost:6379)
REDIS_HOST=localhost
REDIS_PORT=6379

# Optional: OpenAI API Key (for /ai/chat endpoint)
OPENAI_API_KEY=sk-your-api-key-here
```

### Generate Secrets

```bash
# Generate JWT secret (32+ chars)
openssl rand -hex 32

# Generate API salt (16+ chars)
openssl rand -hex 16
```

---

## Step 3: Start Services

### Quick Start: All Services with Docker

```bash
# Start app + MySQL + Redis + Qdrant
npm run docker:up

# Verify all services are running
docker compose -f docker/docker-compose.yml ps
```

Expected output:
```
NAME           STATUS
finbridge-app  Up 2 minutes
mysql          Up 2 minutes
redis          Up 2 minutes
qdrant         Up 2 minutes
```

### Development: Start Services Individually

```bash
# Start MySQL + Redis + Qdrant (without app)
docker compose -f docker/docker-compose.yml up -d mysql redis qdrant

# Verify
docker compose -f docker/docker-compose.yml ps
```

---

## Step 4: Verify Installation

### Check Server Health

```bash
# Wait 5 seconds for startup
sleep 5

# Check health endpoint
curl http://localhost:3000/health/ready

# Expected response
# {"status":"ready","dependencies":{"mysql":"ok","redis":"ok"}}
```

### Check API Documentation

```bash
# Open in browser
http://localhost:3000/docs
```

You should see Swagger API documentation with all endpoints.

### Check Qdrant Vector Database (if using AI features)

```bash
# Open Qdrant dashboard
http://localhost:6333/dashboard
```

---

## Step 5: Create Your First Token

```bash
# Get a JWT token (development only)
curl -X POST http://localhost:3000/auth/token \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "dev-user",
    "role": "analyst",
    "secret": "dev_bootstrap"
  }'

# Copy the token from response
# {
#   "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
#   "expiresIn": 86400
# }
```

---

## Step 6: Test the MCP Tools

### List Available Tools

```bash
TOKEN="your_token_from_step_5"

curl http://localhost:3000/tools \
  -H "Authorization: Bearer $TOKEN"

# Response lists all static + dynamic tools
```

### Execute a Tool

```bash
TOKEN="your_token_from_step_5"

curl -X POST http://localhost:3000/tools/get_bank_health/execute \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"args": {}}'
```

---

## Step 7: Connect Claude Desktop (Optional)

### Prerequisites

- Claude Desktop app installed — [Download](https://claude.ai/download)
- JWT token from Step 5

### Configuration

1. Open `~/.config/claude/claude_desktop_config.json`

2. Add the FinBridge MCP server:

```json
{
  "mcpServers": {
    "finbridge": {
      "url": "http://localhost:3000/mcp/sse",
      "headers": {
        "Authorization": "Bearer YOUR_JWT_TOKEN_HERE"
      }
    }
  }
}
```

3. Restart Claude Desktop

4. Click the **🔧 Hammer** icon to verify the connection

---

## Step 8: Database Schema (Optional)

### Load Sample Data

```bash
# MySQL is already running from docker-compose
# The schema is initialized automatically

# To view the database:
docker compose -f docker/docker-compose.yml exec mysql mysql -u root -p finbridge_db

# Inside MySQL shell:
SHOW TABLES;
SELECT * FROM transactions LIMIT 5;
EXIT;
```

### Push Schema Changes

If you modify the Drizzle schema:

```bash
npm run db:push
```

### Open Drizzle Studio

Visual SQL editor for your database:

```bash
npm run db:studio
```

Opens at `http://localhost:5555`

---

## Step 9: Development Workflow

### Start Development Server with Hot Reload

```bash
# In a new terminal (services still running from Step 3)
npm run dev

# You should see:
# ✓ Server running at http://localhost:3000
# ✓ Ready for requests
```

### Run Type Checking

```bash
npm run typecheck
```

### Format & Lint Code

```bash
npm run lint
```

### Generate Tools from Database

```bash
npm run generate-tools

# Output shows all discovered tables and generated tools
```

---

## Troubleshooting

### Problem: "MySQL connection refused"

```bash
# Check if MySQL is running
docker compose -f docker/docker-compose.yml ps mysql

# If not running, start it
docker compose -f docker/docker-compose.yml up -d mysql

# Wait 10 seconds for MySQL to be ready
sleep 10

# Check logs
docker compose -f docker/docker-compose.yml logs mysql
```

### Problem: "Redis ECONNREFUSED"

```bash
# Check if Redis is running
docker compose -f docker/docker-compose.yml ps redis

# If not, start it
docker compose -f docker/docker-compose.yml up -d redis

# Verify connection
redis-cli ping  # Should return PONG
```

### Problem: "JWT signature invalid"

```bash
# Check JWT_SECRET in .env
grep JWT_SECRET .env

# If empty or invalid, generate new one
openssl rand -hex 32

# Update .env with new value and restart server
npm run dev
```

### Problem: "Schema not found / no tables"

```bash
# Make sure MySQL is initialized
docker compose -f docker/docker-compose.yml exec mysql mysql -u root -p finbridge_db

# If tables are missing, reimport schema
npm run db:push

# Or manually load the init script
docker compose -f docker/docker-compose.yml exec mysql mysql -u root -p finbridge_db < docker/init.sql
```

### Problem: "Port 3000 already in use"

```bash
# Find what's using port 3000
lsof -i :3000

# Kill the process
kill -9 <PID>

# Or use a different port
PORT=3001 npm run dev
```

### Problem: "Docker containers won't start"

```bash
# Check Docker logs
docker compose -f docker/docker-compose.yml logs

# Reset Docker (warning: removes all containers/images)
docker compose -f docker/docker-compose.yml down -v
docker system prune -a

# Start fresh
npm run docker:up
```

---

## Security Notes

⚠️ **Development Only**

The `dev_bootstrap` secret used above is **insecure** and only for local testing.

For production, use a proper authentication system:

```bash
# Generate secure secrets
openssl rand -hex 32  # JWT_SECRET
openssl rand -hex 16  # API_KEY_SALT

# Store in environment (not .env file)
export JWT_SECRET="generated_secret"
export API_KEY_SALT="generated_salt"

# Never commit .env to Git
echo ".env" >> .gitignore
```

See `README.md` for production security setup.

---

## Next Steps

1. **Read the Documentation**:
   - `README.md` — Project overview
   - `docs/TECHNICAL_GUIDE.md` — How the system works
   - `CLAUDE.md` — Using Claude Code with this project

2. **Set Up Claude Code Integration**:
   - Open project in Claude Code
   - Ask Claude to "explain the MCP tool flow"
   - Get help building new features

3. **Explore the API**:
   - Visit `http://localhost:3000/docs` for Swagger UI
   - Try executing tools with your token

4. **Review the Code**:
   - Start in `src/server/index.ts` (entry point)
   - Then explore `src/mcp/` (MCP tools)
   - Finally check `src/tools/` (static fintech tools)

---

## Commands Reference

| Command | Purpose |
|---------|---------|
| `npm install` | Install dependencies |
| `npm run dev` | Start dev server with hot reload |
| `npm run typecheck` | Check TypeScript errors |
| `npm run lint` | Format & lint code |
| `npm run build` | Compile TypeScript |
| `npm run test` | Run unit tests |
| `npm run docker:up` | Start all services with Docker |
| `npm run docker:down` | Stop all services |
| `npm run generate-tools` | Scan DB and generate tools |
| `npm run db:push` | Push schema changes |
| `npm run db:studio` | Open visual SQL editor |

---

## Getting Help

- **General questions**: Check `README.md` and `docs/` folder
- **Code questions**: Ask Claude Code (open project in claude.ai/code)
- **Issues**: Check the [GitHub Issues](https://github.com/your-org/finbridge-mcp/issues)
- **Slack/Discord**: Reach out to the team

---

**Happy developing! 🚀**
