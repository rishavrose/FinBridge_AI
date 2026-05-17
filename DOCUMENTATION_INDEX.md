# FinBridge AI — Complete Documentation Index

> **Your guide to all documentation for the FinBridge MCP Server platform**

---

## 🚀 Quick Navigation

### **First Time Here?**
Start with one of these based on your role:

| Role | Start Here | Then Read |
|------|-----------|-----------|
| **New Developer** | [SETUP.md](SETUP.md) | [CLAUDE.md](CLAUDE.md) → [DEVELOPMENT.md](DEVELOPMENT.md) |
| **Using Claude Code** | [CLAUDE.md](CLAUDE.md) | [SETUP.md](SETUP.md) → [README.md](README.md) |
| **DevOps/Platform** | [DEPLOYMENT.md](DEPLOYMENT.md) | [README.md](README.md) → [docs/TECHNICAL_GUIDE.md](docs/TECHNICAL_GUIDE.md) |
| **API Consumer** | [README.md](README.md) | [docs/TECHNICAL_GUIDE.md](docs/TECHNICAL_GUIDE.md) → API docs |
| **Feature Development** | [DEVELOPMENT.md](DEVELOPMENT.md) | [README.md](README.md) → [docs/TECHNICAL_GUIDE.md](docs/TECHNICAL_GUIDE.md) |

---

## 📚 All Documentation Files

### **Root Level Documentation**

| File | Purpose | Length | For Whom |
|------|---------|--------|----------|
| **[README.md](README.md)** | Project overview, features, architecture, quick start | 450 lines | Everyone |
| **[SETUP.md](SETUP.md)** | Complete installation & configuration guide | 400 lines | New developers, DevOps |
| **[CLAUDE.md](CLAUDE.md)** | Guide for using Claude Code with this project | 350 lines | Claude Code users |
| **[DEVELOPMENT.md](DEVELOPMENT.md)** | Code standards, patterns, testing, git workflows | 500 lines | Developers |
| **[DEPLOYMENT.md](DEPLOYMENT.md)** | Production deployment, scaling, monitoring | 600 lines | DevOps, platform engineers |
| **[.env.example](.env.example)** | All environment variables with descriptions | 100 lines | System administrators |

### **Detailed Technical Documentation** (`docs/` folder)

| File | Topic | Key Sections |
|------|-------|--------------|
| **[docs/TECHNICAL_GUIDE.md](docs/TECHNICAL_GUIDE.md)** | How the system works end-to-end | System overview, request flows, tool system, database layer, API reference |
| **[docs/AI_MEMORY_GUIDE.md](docs/AI_MEMORY_GUIDE.md)** | Semantic caching & self-learning system | Architecture, vector search, confidence tiers, performance targets |
| **[docs/FRONTEND_GUIDE.md](docs/FRONTEND_GUIDE.md)** | Web app development & UI | Frontend setup, components, styling, deployment |

---

## 🎯 Documentation by Topic

### **Getting Started**

| I want to... | Read this |
|--------------|-----------|
| Install FinBridge locally | [SETUP.md](SETUP.md) → Step 1-8 |
| Understand what this project does | [README.md](README.md) → Features & Architecture |
| See the system architecture | [README.md](README.md) → Architecture Overview |
| Use it with Claude AI | [CLAUDE.md](CLAUDE.md) → Quick Start |

### **Development**

| I want to... | Read this |
|--------------|-----------|
| Write production-quality code | [DEVELOPMENT.md](DEVELOPMENT.md) → Code Standards |
| Add a new feature/tool | [DEVELOPMENT.md](DEVELOPMENT.md) → Adding Features |
| Write tests | [DEVELOPMENT.md](DEVELOPMENT.md) → Testing |
| Understand code organization | [DEVELOPMENT.md](DEVELOPMENT.md) → Project Structure |
| Debug an issue | [DEVELOPMENT.md](DEVELOPMENT.md) → Debugging |
| Follow git workflow | [DEVELOPMENT.md](DEVELOPMENT.md) → Git Workflow |

### **API & Integration**

| I want to... | Read this |
|--------------|-----------|
| Use REST endpoints | [README.md](README.md) → Execute a Tool via REST |
| Understand tool system | [docs/TECHNICAL_GUIDE.md](docs/TECHNICAL_GUIDE.md) → Tool System |
| Call tools with OpenAI | [README.md](README.md) → AI Chat |
| Connect Claude Desktop | [README.md](README.md) → Connect Claude Desktop |
| View all endpoints | `http://localhost:3000/docs` (Swagger) |

### **Database & Performance**

| I want to... | Read this |
|--------------|-----------|
| Understand database flow | [README.md](README.md) → Database Flow |
| Use the query builder safely | [DEVELOPMENT.md](DEVELOPMENT.md) → Database Operations |
| Optimize queries | [DEVELOPMENT.md](DEVELOPMENT.md) → Performance |
| Cache data effectively | [DEVELOPMENT.md](DEVELOPMENT.md) → Common Patterns |
| Scale the database | [DEPLOYMENT.md](DEPLOYMENT.md) → Scaling |

### **AI & Semantic Caching**

| I want to... | Read this |
|--------------|-----------|
| Understand AI memory system | [docs/AI_MEMORY_GUIDE.md](docs/AI_MEMORY_GUIDE.md) → Overview |
| Use semantic caching | [docs/AI_MEMORY_GUIDE.md](docs/AI_MEMORY_GUIDE.md) → Confidence Tiers |
| Monitor cache performance | [docs/AI_MEMORY_GUIDE.md](docs/AI_MEMORY_GUIDE.md) → Performance Targets |
| View cache statistics | [CLAUDE.md](CLAUDE.md) → Common Tasks |

### **Security & Authentication**

| I want to... | Read this |
|--------------|-----------|
| Understand RBAC | [README.md](README.md) → Role Permissions |
| Create tokens | [SETUP.md](SETUP.md) → Step 5 |
| Manage API keys | [README.md](README.md) → Authentication |
| Review security | [README.md](README.md) → Security Architecture |
| Secure for production | [DEPLOYMENT.md](DEPLOYMENT.md) → Security Hardening |

### **Operations & Deployment**

| I want to... | Read this |
|--------------|-----------|
| Deploy to production | [DEPLOYMENT.md](DEPLOYMENT.md) → Docker Deployment |
| Use Kubernetes | [DEPLOYMENT.md](DEPLOYMENT.md) → Kubernetes Deployment |
| Monitor in production | [DEPLOYMENT.md](DEPLOYMENT.md) → Monitoring & Observability |
| Set up backups | [DEPLOYMENT.md](DEPLOYMENT.md) → Backup & Recovery |
| Scale the system | [DEPLOYMENT.md](DEPLOYMENT.md) → Scaling |
| Handle incidents | [DEPLOYMENT.md](DEPLOYMENT.md) → Troubleshooting |

### **Frontend Development**

| I want to... | Read this |
|--------------|-----------|
| Set up frontend locally | [docs/FRONTEND_GUIDE.md](docs/FRONTEND_GUIDE.md) → Getting Started |
| Understand component structure | [docs/FRONTEND_GUIDE.md](docs/FRONTEND_GUIDE.md) → Architecture |
| Work with styling | [docs/FRONTEND_GUIDE.md](docs/FRONTEND_GUIDE.md) → Styling |
| Deploy the web app | [docs/FRONTEND_GUIDE.md](docs/FRONTEND_GUIDE.md) → Deployment |

---

## 🔗 Cross-References

### For Common Tasks

**"How do I...?"**

| Common Task | Solution | Docs |
|-------------|----------|------|
| Add a new API endpoint | Create a Fastify route | [DEVELOPMENT.md](DEVELOPMENT.md#adding-features) |
| Create a new MCP tool | Register in tool registry | [DEVELOPMENT.md](DEVELOPMENT.md#example-add-new-tool) |
| Deploy to Kubernetes | Apply manifests in k8s/ | [DEPLOYMENT.md](DEPLOYMENT.md#kubernetes-deployment) |
| Fix a TypeScript error | Check types, use `npm run typecheck` | [DEVELOPMENT.md](DEVELOPMENT.md#typescript) |
| Debug a slow query | Enable query logs, profile | [DEVELOPMENT.md](DEVELOPMENT.md#performance) |
| Set up Claude integration | Update config, get token | [CLAUDE.md](CLAUDE.md#step-7-connect-claude-desktop) |
| Create an API key | Use `/auth/api-keys` endpoint | [README.md](README.md#api-keys) |
| Monitor cache hit rate | Call `/ai/chat/stats` | [docs/AI_MEMORY_GUIDE.md](docs/AI_MEMORY_GUIDE.md#get-aichatstas) |
| Backup the database | Use mysqldump or RDS snapshots | [DEPLOYMENT.md](DEPLOYMENT.md#automated-backups) |

---

## 📖 Reading Paths by Use Case

### **Path 1: I'm a new developer on the team**

1. [SETUP.md](SETUP.md) — Get the project running locally (30 min)
2. [README.md](README.md) — Understand what it does (15 min)
3. [CLAUDE.md](CLAUDE.md) — Learn how to use Claude Code (15 min)
4. [docs/TECHNICAL_GUIDE.md](docs/TECHNICAL_GUIDE.md) — Understand system design (30 min)
5. [DEVELOPMENT.md](DEVELOPMENT.md) — Learn code standards (30 min)

**Total time**: ~2 hours → Ready to start coding

### **Path 2: I'm setting up production**

1. [DEPLOYMENT.md](DEPLOYMENT.md) — Choose deployment method (20 min)
2. [DEPLOYMENT.md](DEPLOYMENT.md#environment-configuration) — Configure environment (15 min)
3. [DEPLOYMENT.md](DEPLOYMENT.md#security-hardening) — Secure the system (20 min)
4. [DEPLOYMENT.md](DEPLOYMENT.md#monitoring--observability) — Set up monitoring (20 min)
5. [DEPLOYMENT.md](DEPLOYMENT.md#backup--recovery) — Configure backups (15 min)

**Total time**: ~1.5 hours → Production ready

### **Path 3: I'm adding a feature**

1. [DEVELOPMENT.md](DEVELOPMENT.md#adding-features) — Plan your feature (10 min)
2. [README.md](README.md#mcp-tools) — Understand tool architecture (10 min)
3. [DEVELOPMENT.md](DEVELOPMENT.md#example-add-new-tool) — Follow the example (30 min)
4. [DEVELOPMENT.md](DEVELOPMENT.md#testing) — Write tests (20 min)
5. [DEVELOPMENT.md](DEVELOPMENT.md#git-workflow) — Submit PR (10 min)

**Total time**: ~1.5 hours for a complete feature

### **Path 4: I'm using Claude Code**

1. [CLAUDE.md](CLAUDE.md) — Start here (5 min)
2. [CLAUDE.md](CLAUDE.md#common-tasks) — Reference common tasks (5 min)
3. [SETUP.md](SETUP.md) — When you need to set up something (varies)
4. Ask Claude: "Explain [topic]" (varies)

**Total time**: Ongoing as needed

---

## 🎓 Concept Index

### Core Concepts

| Concept | Explained In | Key Points |
|---------|-------------|-----------|
| **MCP Protocol** | [README.md](README.md#architecture-overview), [docs/TECHNICAL_GUIDE.md](docs/TECHNICAL_GUIDE.md#3-mcp-protocol--how-it-works-here) | API standard for AI integration |
| **Tools** | [README.md](README.md#mcp-tools), [docs/TECHNICAL_GUIDE.md](docs/TECHNICAL_GUIDE.md#4-tool-system) | Functions exposed to AI clients |
| **RBAC** | [README.md](README.md#role-permissions), [DEVELOPMENT.md](DEVELOPMENT.md#set-permissions) | Role-based permission system |
| **Caching** | [docs/AI_MEMORY_GUIDE.md](docs/AI_MEMORY_GUIDE.md), [DEVELOPMENT.md](DEVELOPMENT.md#using-cache) | Redis + vector caching |
| **JWT Auth** | [README.md](README.md#jwt-bearer-token), [SETUP.md](SETUP.md#step-5-create-your-first-token) | Token-based authentication |
| **Query Safety** | [README.md](README.md#security-architecture), [DEVELOPMENT.md](DEVELOPMENT.md#safe-queries) | Parameterized queries only |

---

## 🔧 Reference Quick Links

### Important Files

```
finbridge-mcp/
├── README.md                    ← Start here for overview
├── SETUP.md                     ← Installation guide
├── CLAUDE.md                    ← Using Claude Code
├── DEVELOPMENT.md               ← Code standards
├── DEPLOYMENT.md                ← Production guide
├── .env.example                 ← All config options
├── src/server/index.ts          ← App entry point
├── src/mcp/                     ← MCP server code
├── src/tools/                   ← Tool definitions
├── docs/
│   ├── TECHNICAL_GUIDE.md       ← System design
│   ├── AI_MEMORY_GUIDE.md       ← Caching system
│   └── FRONTEND_GUIDE.md        ← Web app
└── docker/docker-compose.yml    ← Services config
```

### Commands Quick Reference

```bash
# Development
npm run dev              # Start with hot reload
npm run typecheck       # Check TypeScript
npm run lint            # Format code
npm run test            # Run tests

# Database
npm run db:push         # Push schema
npm run db:studio       # Visual editor
npm run generate-tools  # Scan DB for tools

# Docker
npm run docker:up       # Start all services
npm run docker:down     # Stop all services

# Build
npm run build           # Compile for production
npm run docker:build    # Build Docker image
```

### API Documentation

```
http://localhost:3000/docs              # Swagger UI
http://localhost:3000/health/ready      # Health check
http://localhost:3000/health/info       # Full diagnostics
http://localhost:6333/dashboard         # Qdrant vector DB
```

---

## 🤝 Contributing

### Before Making Changes

1. **Read**: [DEVELOPMENT.md](DEVELOPMENT.md) — Code standards
2. **Create branch**: `feature/my-feature` (see [Git Workflow](DEVELOPMENT.md#git-workflow))
3. **Test**: `npm run test` must pass
4. **TypeCheck**: `npm run typecheck` must pass
5. **Submit**: Create PR with clear description

---

## 🆘 Getting Help

### Where to Find Answers

| Question | Try This |
|----------|----------|
| "How do I...?" | Search this index 👆 |
| "What's the architecture?" | [README.md](README.md) + [docs/TECHNICAL_GUIDE.md](docs/TECHNICAL_GUIDE.md) |
| "How do I code X?" | [DEVELOPMENT.md](DEVELOPMENT.md#common-patterns) |
| "How do I deploy?" | [DEPLOYMENT.md](DEPLOYMENT.md) |
| "How do I use Claude Code?" | [CLAUDE.md](CLAUDE.md) |
| "How do I set up locally?" | [SETUP.md](SETUP.md) |
| Technical/system question | Ask Claude Code with the project open |
| Stuck on a bug? | Ask Claude: "Debug this issue:" |

---

## 📊 Documentation Stats

| Metric | Value |
|--------|-------|
| Total documentation files | 8 |
| Total lines of documentation | ~3,500 |
| Estimated read time (all docs) | ~4-5 hours |
| Quick start time | ~30 minutes |
| Average file size | ~440 lines |

---

## ✅ Checklist: Have You Read?

- [ ] [README.md](README.md) — Project overview
- [ ] [SETUP.md](SETUP.md) — Installation (if running locally)
- [ ] [CLAUDE.md](CLAUDE.md) — If using Claude Code
- [ ] [DEVELOPMENT.md](DEVELOPMENT.md) — Before writing code
- [ ] [DEPLOYMENT.md](DEPLOYMENT.md) — Before going to production
- [ ] [docs/TECHNICAL_GUIDE.md](docs/TECHNICAL_GUIDE.md) — For deep understanding
- [ ] [.env.example](.env.example) — Before setting up environment

---

## 🚀 Last Updated

**Documentation updated**: May 15, 2026  
**Project version**: 1.0.0  
**Node.js requirement**: ≥ 20.0.0

---

**Start reading and building! Questions? Ask Claude Code.** 💡