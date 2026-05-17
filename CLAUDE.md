# Using Claude Code with FinBridge AI

> **Guide for developers using Claude Code (Claude AI) with the FinBridge MCP Server project**

---

## Quick Start

### Clone & Open in Claude Code

```bash
# Clone the repository
git clone https://github.com/your-org/finbridge-mcp.git
cd finbridge-mcp

# Open in Claude Code (VSCode extension)
# Or use the web app at claude.ai/code
```

### First Time Setup

1. **Read the context**: Claude Code loads the entire project structure into context. Start with:
   - `README.md` — Architecture overview
   - `docs/TECHNICAL_GUIDE.md` — How the system works
   - `docs/AI_MEMORY_GUIDE.md` — Semantic caching and learning system

2. **Ask Claude to set up your environment**:
   ```
   "Set up my development environment for FinBridge AI"
   ```
   Claude will:
   - Create `.env` from `.env.example`
   - Generate JWT secrets
   - Start Docker services
   - Verify the dev server

3. **Start developing**: Ask Claude for help with:
   - Bug fixes
   - New features
   - Code refactoring
   - API integrations
   - Security reviews

---

## Common Tasks

### 🔧 Development Tasks

```bash
# Start development server
npm run dev

# Run type checking
npm run typecheck

# Format & lint code
npm run lint

# Generate tools from schema
npm run generate-tools
```

**Ask Claude**: "Fix the TypeScript error in `src/tools/transactions.ts`"

### 🗄️ Database Work

```bash
# Push schema changes
npm run db:push

# Open Drizzle Studio
npm run db:studio

# Generate new tools from DB
npm run generate-tools
```

**Ask Claude**: "Add a new table query tool for settlements"

### 🐳 Docker Operations

```bash
# Full stack (app + MySQL + Redis + Qdrant)
npm run docker:up

# Development (MySQL/Redis only)
docker compose -f docker/docker-compose.yml up -d mysql redis

# Production build & run
npm run docker:build
npm run docker:prod
```

**Ask Claude**: "Debug why the Docker MySQL container won't start"

### 🧪 Testing

```bash
# Run tests
npm run test

# Run specific test file
npx jest src/tools/__tests__/transactions.test.ts
```

**Ask Claude**: "Write unit tests for the new `get_failed_payouts` tool"

### 🚀 Deployment

```bash
# Build for production
npm run build

# Deploy to Kubernetes
kubectl apply -f k8s/
```

**Ask Claude**: "Update the K8s manifests for the new API_KEY_SALT environment variable"

---

## Code Organization

### Key Directories

```
src/
├── config/          # Environment & secrets
├── types/           # TypeScript interfaces
├── database/        # MySQL client, schema scanner
├── cache/           # Redis caching layer
├── auth/            # JWT, API keys, RBAC
├── mcp/             # MCP server & tool registry
├── tools/           # Fintech tools (transactions, payouts, etc.)
├── openai/          # OpenAI integration
├── ai/              # Memory, embeddings, learning
├── server/          # Fastify routes & bootstrapping
└── queue/           # BullMQ async workers
```

### Naming Conventions

- **Files**: `kebab-case.ts` (e.g., `query-builder.ts`)
- **Functions**: `camelCase` (e.g., `executeSelect()`)
- **Types**: `PascalCase` (e.g., `type ToolResult`)
- **Constants**: `SCREAMING_SNAKE_CASE` (e.g., `MAX_QUERY_LIMIT`)
- **Classes**: `PascalCase` (e.g., `AuthManager`)

**Ask Claude**: "Refactor `src/database/queryBuilder.ts` to match the project naming conventions"

---

## Security Considerations

⚠️ **Read before making changes**:
- `docs/SECURITY_CONSIDERATIONS.md` — Security best practices
- `src/database/query-builder.ts` — SQL injection prevention
- `src/auth/rbac.ts` — Permission levels and checks

**Never**:
- Use raw SQL strings (always use parameterised queries)
- Store credentials in code (use `.env`)
- Expose `api_key_salt` or `JWT_SECRET` to logs
- Add write operations (readonly only)

**Ask Claude**: "Security review: does this API endpoint leak sensitive data?"

---

## API Development

### Adding a New REST Endpoint

```typescript
// src/server/routes/my-route.ts
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export async function myRoutes(fastify: FastifyInstance) {
  fastify.get('/my-endpoint', async (req: FastifyRequest, reply: FastifyReply) => {
    // Your logic here
    return { success: true };
  });
}
```

**Ask Claude**: "Add a new REST endpoint `/analytics/cache-stats` that returns Redis cache statistics"

### Adding a New MCP Tool

```typescript
// src/tools/my-tool.ts
export const myTool = {
  name: 'my_tool_name',
  description: 'What this tool does',
  inputSchema: {
    type: 'object',
    properties: {
      param1: { type: 'string', description: 'First parameter' }
    },
    required: ['param1']
  },
  handler: async (args) => {
    // Tool logic
    return { result: 'output' };
  }
};
```

**Ask Claude**: "Create a new MCP tool for searching transactions by merchant ID"

---

## Debugging

### Enable Debug Logs

```bash
DEBUG=* npm run dev
```

### Trace a Request

```bash
# Enable detailed logs
NODE_OPTIONS='--inspect' npm run dev:debug

# Open chrome://inspect in Chrome
# Click "Inspect" to connect debugger
```

### Common Issues

| Problem | Solution |
|---------|----------|
| "MySQL connection refused" | Check `docker compose -f docker/docker-compose.yml ps` — MySQL running? |
| "Redis ECONNREFUSED" | Verify Redis is running: `redis-cli ping` should return `PONG` |
| "JWT signature invalid" | Generate new secret: `openssl rand -hex 32`, update `.env` |
| "Permission denied" error | Check `src/auth/rbac.ts` — does user role have access to this tool? |

**Ask Claude**: "Debug: I'm getting a 'No such table' error. What went wrong?"

---

## Performance & Optimization

### Monitor Cache Performance

```bash
# Check Redis cache hit rate
curl http://localhost:3000/ai/chat/stats \
  -H "Authorization: Bearer <token>"
```

### Profile Slow Queries

```bash
# Enable query logging
SLOW_QUERY_LOG=true npm run dev

# Check logs for queries > 1000ms
```

**Ask Claude**: "Optimize this query — it's taking 3+ seconds to execute"

---

## Testing with Claude

### Ask Claude to:
- ✅ Write unit tests for a new tool
- ✅ Create integration tests for API endpoints
- ✅ Fix failing tests
- ✅ Improve test coverage
- ✅ Load test the MCP server

**Example**:
```
"Write comprehensive tests for the get_recent_transactions tool.
Include edge cases: empty results, large datasets, invalid date ranges."
```

---

## Version Control & Commits

### Branch Naming

```
feature/add-settlement-tool
bugfix/fix-jwt-expiry
docs/update-api-guide
refactor/optimize-query-builder
```

### Commit Messages

```
Add semantic cache statistics endpoint (#123)

- Add /ai/chat/stats REST endpoint
- Return Redis + Qdrant hit rates
- Include average response time
```

**Ask Claude**: "Create a commit for the changes we just made"

---

## Learning & Exploration

### Understand the Codebase

**Ask Claude**:
- "Explain how the MCP SSE transport works"
- "Walk me through the request flow for a tool call"
- "Show me how Redis caching reduces database load"
- "How does RBAC prevent unauthorized tool access?"

### Improve Code Quality

**Ask Claude**:
- "Refactor this function to be more efficient"
- "Add TypeScript types to this untyped code"
- "Split this large file into smaller modules"
- "Update this deprecated dependency"

### Explore New Features

**Ask Claude**:
- "How would we add webhook support for AI learning events?"
- "What would it take to support PostgreSQL in addition to MySQL?"
- "How can we add rate limiting per tool instead of per IP?"

---

## Useful Commands

```bash
# Type safety
npm run typecheck

# Code quality
npm run lint

# Build for production
npm run build

# Check deployed version
http://localhost:3000/health/info

# View API docs
http://localhost:3000/docs

# Generate tools catalog
npm run generate-tools -- --output tools.json

# Clean build artifacts
npm run clean
```

---

## Common Claude Code Questions

### "How do I..."

| Question | Ask Claude |
|----------|-----------|
| ...add a new API endpoint? | "Add a new Fastify route for..." |
| ...create a new tool? | "Create a new MCP tool for..." |
| ...debug a TypeScript error? | "Fix the TS error in..." |
| ...optimize a slow query? | "Profile and optimize..." |
| ...test a feature? | "Write tests for..." |
| ...secure a route? | "Add authentication/RBAC to..." |
| ...improve performance? | "Optimize the cache strategy for..." |

---

## Tips for Working with Claude

1. **Be specific**: "Fix the auth middleware" vs "Add JWT refresh token support with 7-day rotation"
2. **Provide context**: Paste error messages, include relevant file paths
3. **Verify changes**: Always test new code — Claude can help, but verify in your environment
4. **Ask follow-ups**: "Explain what you just changed" — understand the code
5. **Use the memory**: Claude learns from your preferences — tell it what works/doesn't work

---

## Resources

- **Main README**: `README.md` — Start here for architecture
- **Technical Deep Dive**: `docs/TECHNICAL_GUIDE.md` — How everything works
- **AI Memory System**: `docs/AI_MEMORY_GUIDE.md` — Semantic caching
- **Frontend**: `docs/FRONTEND_GUIDE.md` — Web app development
- **Environment Variables**: `.env.example` — All configuration options

---

## Questions or Issues?

Ask Claude Code:
```
"Help me with [task]. Here's the error I'm seeing: [paste error]"
```

Claude will:
- ✅ Read relevant source files
- ✅ Identify the root cause
- ✅ Propose a fix or refactor
- ✅ Test the changes
- ✅ Explain what was changed and why
