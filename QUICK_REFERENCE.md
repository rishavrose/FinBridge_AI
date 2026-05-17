# FinBridge AI — Quick Reference Card

> **Essential commands, links, and tips on one page**

---

## 🚀 Quick Start (5 minutes)

```bash
# 1. Clone & install
git clone https://github.com/your-org/finbridge-mcp.git
cd finbridge-mcp
npm install

# 2. Setup environment
bash scripts/setup.sh

# 3. Start services
npm run docker:up

# 4. Verify
curl http://localhost:3000/health/ready

# 5. Get a token
curl -X POST http://localhost:3000/auth/token \
  -H "Content-Type: application/json" \
  -d '{"userId":"dev","role":"analyst","secret":"dev_bootstrap"}' | jq .token
```

---

## 📋 Essential Commands

### Development
```bash
npm run dev              # Start with hot reload
npm run typecheck       # TypeScript errors
npm run lint            # Format & lint
npm run test            # Run tests
npm run build           # Compile
```

### Database
```bash
npm run db:push         # Push schema changes
npm run db:studio       # Visual editor (port 5555)
npm run generate-tools  # Scan DB → generate tools
```

### Docker
```bash
npm run docker:up       # Start all services
npm run docker:down     # Stop services
docker compose -f docker/docker-compose.yml logs -f app  # View logs
```

### API
```bash
# List tools
curl http://localhost:3000/tools \
  -H "Authorization: Bearer $TOKEN"

# Execute a tool
curl -X POST http://localhost:3000/tools/get_bank_health/execute \
  -H "Authorization: Bearer $TOKEN"

# View API docs
# http://localhost:3000/docs
```

---

## 🔗 Important URLs

| Service | URL | Purpose |
|---------|-----|---------|
| **API Docs** | http://localhost:3000/docs | Swagger UI |
| **Health Check** | http://localhost:3000/health/ready | Is app running? |
| **Diagnostics** | http://localhost:3000/health/info | Full system status |
| **Qdrant** | http://localhost:6333/dashboard | Vector DB admin |
| **Drizzle Studio** | http://localhost:5555 | Visual SQL editor |

---

## 📁 Key Files

```
src/
├── server/index.ts          # App entry point
├── tools/                   # Tool definitions
├── database/                # DB access
├── cache/                   # Redis
├── auth/                    # JWT & RBAC
├── mcp/                     # MCP server
└── ai/                      # AI memory system

docs/
├── TECHNICAL_GUIDE.md       # System design
├── AI_MEMORY_GUIDE.md       # Caching
└── FRONTEND_GUIDE.md        # Web app

docker/
├── docker-compose.yml       # Dev stack
├── docker-compose.prod.yml  # Prod stack
└── init.sql                 # DB schema

k8s/
├── deployment.yaml          # K8s deployment
├── service.yaml             # K8s service
├── ingress.yaml             # Ingress
└── configmap.yaml           # Config
```

---

## 🎯 Common Tasks

### Add a New Tool
```typescript
// 1. Create src/tools/my-tool.ts
export const myTool = {
  name: 'my_tool',
  description: '...',
  inputSchema: { ... },
  handler: async (args) => { ... }
};

// 2. Register in src/tools/index.ts
export { myTool } from './my-tool';

// 3. Add to STATIC_TOOLS array in registry
```

### Add a REST Endpoint
```typescript
// src/server/routes/my-route.ts
export async function myRoutes(fastify) {
  fastify.get('/my-endpoint', async (req, reply) => {
    return { success: true };
  });
}

// Register in src/server/index.ts
app.register(myRoutes);
```

### Debug Something
```bash
# Enable debug logs
DEBUG=* npm run dev

# Or with Node debugger
npm run dev:debug
# Then: chrome://inspect
```

### Deploy to Kubernetes
```bash
kubectl apply -f k8s/
kubectl get pods -n finbridge
kubectl logs -f deployment/finbridge-mcp -n finbridge
```

---

## 🔐 Security Essentials

| Item | Rule | Command |
|------|------|---------|
| **JWT Secret** | 32+ chars | `openssl rand -hex 32` |
| **API Key Salt** | 16+ chars | `openssl rand -hex 16` |
| **Database** | Read-only only | ✅ GRANT SELECT |
| **Secrets** | Never in code | Use `.env` + `.gitignore` |
| **SQL** | Parameterized | ✅ `executeSelect(query, [params])` |
| **TLS** | Always in prod | ✅ HTTPS required |

---

## 🐛 Troubleshooting

| Problem | Solution |
|---------|----------|
| MySQL won't connect | `docker compose ... ps mysql` → `docker logs` |
| Port 3000 in use | `lsof -i :3000` → `kill -9 <PID>` |
| Redis connection failed | `redis-cli ping` → should return PONG |
| JWT invalid | Regenerate: `openssl rand -hex 32` |
| Tests failing | `npm run test` → check logs |
| TypeScript errors | `npm run typecheck` → fix imports |

---

## 📚 Documentation Map

| Document | Read Time | For |
|----------|-----------|-----|
| [README.md](README.md) | 15 min | Overview |
| [SETUP.md](SETUP.md) | 30 min | Installation |
| [CLAUDE.md](CLAUDE.md) | 15 min | Claude Code users |
| [DEVELOPMENT.md](DEVELOPMENT.md) | 45 min | Developers |
| [DEPLOYMENT.md](DEPLOYMENT.md) | 45 min | DevOps |
| [DOCUMENTATION_INDEX.md](DOCUMENTATION_INDEX.md) | 10 min | Navigation |
| [docs/TECHNICAL_GUIDE.md](docs/TECHNICAL_GUIDE.md) | 60 min | Deep dive |

---

## 🤖 Using Claude Code

```
# Ask Claude to:
"Set up my development environment"
"Explain how the MCP tool flow works"
"Fix this TypeScript error: [error]"
"Write tests for this function"
"Optimize this query"
"Review my code for security issues"
```

---

## 🔑 Environment Variables (Quick List)

```env
# Server
NODE_ENV=production
PORT=3000

# Database
DB_HOST=localhost
DB_NAME=finbridge_db
DB_USER=readonly_user
DB_PASSWORD=password

# Cache
REDIS_HOST=localhost
REDIS_PORT=6379

# Auth
JWT_SECRET=32_char_secret_here
API_KEY_SALT=16_char_salt_here

# Vector DB
QDRANT_URL=http://localhost:6333

# OpenAI (optional)
OPENAI_API_KEY=sk-...
```

See [.env.example](.env.example) for all options.

---

## ⚙️ Git Workflow

```bash
# 1. Create branch
git checkout -b feature/my-feature

# 2. Make changes
# ... edit files ...

# 3. Verify
npm run typecheck
npm run lint
npm run test

# 4. Commit
git commit -m "feat: description here"

# 5. Push & create PR
git push origin feature/my-feature
```

Branch naming:
- `feature/description` — New feature
- `bugfix/description` — Bug fix
- `docs/description` — Documentation
- `refactor/description` — Code cleanup

---

## 📊 Performance Targets

| Component | Target | Check |
|-----------|--------|-------|
| Redis cache hit | > 60% | `/ai/chat/stats` |
| Average response | < 500ms | Logs |
| p99 latency | < 2000ms | Datadog |
| Database connection pool | < 90% | Health check |

---

## 🚦 Health Checks

```bash
# Is app running?
curl http://localhost:3000/health/live
# → {"status":"alive"}

# Is app ready?
curl http://localhost:3000/health/ready
# → {"status":"ready","dependencies":{...}}

# Full diagnostics
curl http://localhost:3000/health/info
# → {"version":"1.0.0","uptime":3600,...}
```

---

## 💡 Pro Tips

1. **Use Claude Code** — Ask it questions instead of searching docs
2. **Keep TS strict** — `"strict": true` catches bugs early
3. **Test as you code** — Don't write tests after
4. **Cache strategic data** — Reduces DB load
5. **Monitor in production** — Set up Datadog/New Relic early
6. **Use parameterized queries** — Always, no exceptions
7. **Document the WHY** — Not the WHAT
8. **Small commits** — Easier to review & revert
9. **Read existing code** — Patterns are your guide
10. **Ask for help** — Claude is always available

---

## 🔗 Useful Links

- **Project Repo**: https://github.com/your-org/finbridge-mcp
- **API Spec**: http://localhost:3000/docs
- **MCP Spec**: https://github.com/modelcontextprotocol/specification
- **TypeScript**: https://www.typescriptlang.org/docs/
- **Fastify**: https://www.fastify.io/docs/
- **MySQL**: https://dev.mysql.com/doc/
- **Redis**: https://redis.io/docs/

---

## 📞 Need Help?

| Question | Answer |
|----------|--------|
| How do I...? | Search [DOCUMENTATION_INDEX.md](DOCUMENTATION_INDEX.md) |
| What's the code doing? | Read [docs/TECHNICAL_GUIDE.md](docs/TECHNICAL_GUIDE.md) |
| How do I code X? | Read [DEVELOPMENT.md](DEVELOPMENT.md) |
| Is something broken? | Check logs & [DEPLOYMENT.md](DEPLOYMENT.md#troubleshooting) |
| Need quick help? | Ask Claude Code (open project in claude.ai/code) |

---

**Print this and keep it handy!** 📋

Last updated: May 15, 2026