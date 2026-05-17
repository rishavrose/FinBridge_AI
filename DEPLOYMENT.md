# Deployment Guide for FinBridge AI

> **Production deployment, scaling, and operations guide for FinBridge MCP Server**

---

## Table of Contents

1. [Pre-Deployment Checklist](#pre-deployment-checklist)
2. [Docker Deployment](#docker-deployment)
3. [Kubernetes Deployment](#kubernetes-deployment)
4. [Environment Configuration](#environment-configuration)
5. [Database Migration](#database-migration)
6. [Monitoring & Observability](#monitoring--observability)
7. [Security Hardening](#security-hardening)
8. [Scaling](#scaling)
9. [Backup & Recovery](#backup--recovery)
10. [Troubleshooting](#troubleshooting)

---

## Pre-Deployment Checklist

### Code Quality

```bash
# Run all checks
npm run typecheck      # No TypeScript errors
npm run lint           # Code formatting correct
npm run test           # All tests pass
npm run build          # Production build succeeds
```

### Security Review

- [ ] No hardcoded secrets in code
- [ ] `.env` file added to `.gitignore`
- [ ] All environment variables documented
- [ ] Database user is read-only
- [ ] JWT secret is 32+ characters
- [ ] API key salt is 16+ characters
- [ ] No raw SQL queries (all parameterized)
- [ ] RBAC roles properly configured
- [ ] Audit logging enabled

### Documentation

- [ ] `README.md` updated
- [ ] Environment variables documented
- [ ] Deployment instructions clear
- [ ] Known issues documented
- [ ] Rollback procedure documented

### Testing

- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Load tests pass (if applicable)
- [ ] Security scan passes
- [ ] Manual testing in staging

---

## Docker Deployment

### Build Production Image

```bash
# Build the image
npm run docker:build

# Tag for registry
docker tag finbridge-mcp:latest your-registry/finbridge-mcp:v1.0.0
docker tag finbridge-mcp:latest your-registry/finbridge-mcp:latest

# Push to registry
docker push your-registry/finbridge-mcp:v1.0.0
docker push your-registry/finbridge-mcp:latest
```

### Docker Compose (Single Server)

```yaml
# docker/docker-compose.prod.yml
version: '3.8'

services:
  app:
    image: your-registry/finbridge-mcp:latest
    container_name: finbridge-mcp
    restart: always
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      PORT: 3000
      DB_HOST: mysql
      DB_PORT: 3306
      DB_NAME: ${DB_NAME}
      DB_USER: ${DB_USER}
      DB_PASSWORD: ${DB_PASSWORD}
      REDIS_HOST: redis
      REDIS_PORT: 6379
      JWT_SECRET: ${JWT_SECRET}
      API_KEY_SALT: ${API_KEY_SALT}
      OPENAI_API_KEY: ${OPENAI_API_KEY}
    depends_on:
      mysql:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health/ready"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    logging:
      driver: "json-file"
      options:
        max-size: "100m"
        max-file: "3"

  mysql:
    image: mysql:8.0
    container_name: finbridge-mysql
    restart: always
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
      MYSQL_DATABASE: ${DB_NAME}
      MYSQL_USER: ${DB_USER}
      MYSQL_PASSWORD: ${DB_PASSWORD}
    volumes:
      - mysql-data:/var/lib/mysql
      - ./docker/init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5
    logging:
      driver: "json-file"
      options:
        max-size: "100m"
        max-file: "3"

  redis:
    image: redis:7-alpine
    container_name: finbridge-redis
    restart: always
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    logging:
      driver: "json-file"
      options:
        max-size: "100m"
        max-file: "3"

  qdrant:
    image: qdrant/qdrant:latest
    container_name: finbridge-qdrant
    restart: always
    environment:
      QDRANT_API_KEY: ${QDRANT_API_KEY}
    volumes:
      - qdrant-data:/qdrant/storage
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:6333/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    logging:
      driver: "json-file"
      options:
        max-size: "100m"
        max-file: "3"

volumes:
  mysql-data:
  redis-data:
  qdrant-data:
```

### Deploy with Docker Compose

```bash
# Create .env file with production values
cp .env.example .env
# Edit .env with production secrets and credentials

# Start services
docker compose -f docker/docker-compose.prod.yml up -d

# Verify health
docker compose -f docker/docker-compose.prod.yml ps
curl http://localhost:3000/health/ready

# View logs
docker compose -f docker/docker-compose.prod.yml logs -f app
```

---

## Kubernetes Deployment

### Prerequisites

- `kubectl` configured to your cluster
- Private Docker registry (ECR, Docker Hub, Harbor)
- Persistent volumes available
- Ingress controller installed

### Namespace & Secrets

```bash
# Create namespace
kubectl create namespace finbridge

# Create secrets (base64 encode sensitive values)
kubectl create secret generic finbridge-secrets \
  --from-literal=JWT_SECRET=$(openssl rand -hex 32) \
  --from-literal=API_KEY_SALT=$(openssl rand -hex 16) \
  --from-literal=DB_PASSWORD=secure_password \
  --from-literal=REDIS_PASSWORD=secure_password \
  --from-literal=OPENAI_API_KEY=sk-your-key \
  -n finbridge

# Create ConfigMap for non-sensitive config
kubectl create configmap finbridge-config \
  --from-literal=DB_HOST=mysql \
  --from-literal=REDIS_HOST=redis \
  --from-literal=NODE_ENV=production \
  -n finbridge
```

### Deployment Manifest

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: finbridge-mcp
  namespace: finbridge
  labels:
    app: finbridge-mcp
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: finbridge-mcp
  template:
    metadata:
      labels:
        app: finbridge-mcp
    spec:
      serviceAccountName: finbridge-sa
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        fsGroup: 1000
      containers:
      - name: app
        image: your-registry/finbridge-mcp:latest
        imagePullPolicy: Always
        ports:
        - name: http
          containerPort: 3000
        env:
        - name: NODE_ENV
          value: "production"
        - name: PORT
          value: "3000"
        - name: DB_HOST
          value: "mysql"
        - name: REDIS_HOST
          value: "redis"
        - name: JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: finbridge-secrets
              key: JWT_SECRET
        - name: API_KEY_SALT
          valueFrom:
            secretKeyRef:
              name: finbridge-secrets
              key: API_KEY_SALT
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health/live
            port: http
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3
        readinessProbe:
          httpGet:
            path: /health/ready
            port: http
          initialDelaySeconds: 20
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 2
        securityContext:
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          capabilities:
            drop:
              - ALL
        volumeMounts:
        - name: tmp
          mountPath: /tmp
      volumes:
      - name: tmp
        emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: finbridge-mcp
  namespace: finbridge
  labels:
    app: finbridge-mcp
spec:
  type: ClusterIP
  ports:
  - name: http
    port: 80
    targetPort: http
  selector:
    app: finbridge-mcp
---
apiVersion: autoscaling.k8s.io/v2
kind: HorizontalPodAutoscaler
metadata:
  name: finbridge-mcp-hpa
  namespace: finbridge
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: finbridge-mcp
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

### Deploy to Kubernetes

```bash
# Apply manifests
kubectl apply -f k8s/

# Verify deployment
kubectl get pods -n finbridge
kubectl get svc -n finbridge

# View logs
kubectl logs -f deployment/finbridge-mcp -n finbridge

# Port forward for testing
kubectl port-forward svc/finbridge-mcp 3000:80 -n finbridge

# Test health
curl http://localhost:3000/health/ready
```

### Ingress Configuration

```yaml
# k8s/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: finbridge-ingress
  namespace: finbridge
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
    nginx.ingress.kubernetes.io/rate-limit: "100"
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - api.finbridge.com
    secretName: finbridge-tls
  rules:
  - host: api.finbridge.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: finbridge-mcp
            port:
              number: 80
```

---

## Environment Configuration

### Production Environment Variables

```env
# Server
NODE_ENV=production
PORT=3000
LOG_LEVEL=info

# Database (use managed service in production)
DB_HOST=your-rds-endpoint.amazonaws.com
DB_PORT=3306
DB_NAME=finbridge_prod
DB_USER=finbridge_user
DB_PASSWORD=very_secure_password_here
DB_SSL=true
DB_POOL_SIZE=20

# Cache (use managed Redis)
REDIS_HOST=your-elasticache-endpoint.amazonaws.com
REDIS_PORT=6379
REDIS_PASSWORD=redis_secure_password
REDIS_TLS=true

# Vector DB (Qdrant)
QDRANT_URL=https://qdrant-cloud.example.com
QDRANT_API_KEY=your_qdrant_api_key
QDRANT_COLLECTION=finbridge_ai_knowledge_prod

# JWT
JWT_SECRET=generated_with_openssl_rand_hex_32
JWT_EXPIRES_IN=86400

# API Keys
API_KEY_SALT=generated_with_openssl_rand_hex_16

# AI Features
OPENAI_API_KEY=sk-your-production-api-key
AI_MEMORY_ENABLED=true
AI_MEMORY_CACHE_TTL=7200

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# Security
CORS_ORIGIN=https://your-frontend-domain.com
CORS_CREDENTIALS=true

# Monitoring
SENTRY_DSN=https://your-sentry-dsn
DATADOG_API_KEY=your_datadog_api_key
```

### Secrets Management

```bash
# AWS Secrets Manager
aws secretsmanager create-secret \
  --name finbridge/prod \
  --secret-string '{
    "JWT_SECRET": "...",
    "API_KEY_SALT": "...",
    "DB_PASSWORD": "..."
  }'

# Kubernetes Secrets
kubectl create secret generic finbridge-secrets \
  --from-literal=JWT_SECRET=$(openssl rand -hex 32) \
  -n finbridge
```

---

## Database Migration

### Pre-Migration Backup

```bash
# Backup production database
mysqldump -h production-db.example.com -u admin -p finbridge_db > backup_$(date +%Y%m%d_%H%M%S).sql

# Or for AWS RDS
aws rds create-db-snapshot \
  --db-instance-identifier finbridge-prod \
  --db-snapshot-identifier finbridge-backup-$(date +%Y%m%d)
```

### Run Migrations

```bash
# Push schema changes
npm run db:push

# Or with Drizzle Kit
npx drizzle-kit push --config drizzle.config.ts

# Verify migration
npm run db:studio
```

### Zero-Downtime Migration Strategy

1. **Deploy with backwards-compatible code** (handles both old + new schema)
2. **Run migrations** (add columns, tables, indices)
3. **Deploy migration code** (use new schema)
4. **Clean up** (remove legacy columns/handling after 2 release cycles)

---

## Monitoring & Observability

### Health Checks

```bash
# Liveness (is app running?)
curl https://api.finbridge.com/health/live

# Readiness (can app handle requests?)
curl https://api.finbridge.com/health/ready

# Full diagnostics
curl https://api.finbridge.com/health/info
```

### Structured Logging

```typescript
// Logs are JSON by default for easy parsing
logger.info(
  { audit: true, userId, tool: 'get_balance', took: 45 },
  'Tool executed successfully'
);
```

### Metrics to Monitor

| Metric | Alert Threshold | Tool |
|--------|-----------------|------|
| Error Rate | > 5% | Datadog, New Relic |
| Response Time (p99) | > 2000ms | CloudWatch |
| Database Connections | > 90% pool | Prometheus |
| Redis Memory | > 85% | Grafana |
| JWT Token Failures | > 10 per min | ELK Stack |
| Cache Hit Rate | < 60% | Custom Dashboard |

### Example Prometheus Metrics

```typescript
// src/utils/metrics.ts
import { Registry, Counter, Histogram } from 'prom-client';

export const register = new Registry();

export const toolCallsTotal = new Counter({
  name: 'tool_calls_total',
  help: 'Total tool calls',
  labelNames: ['tool', 'status'],
  registers: [register]
});

export const toolCallDuration = new Histogram({
  name: 'tool_call_duration_ms',
  help: 'Tool call duration',
  labelNames: ['tool'],
  registers: [register]
});

// In route
app.get('/metrics', (req, res) => {
  res.set('Content-Type', register.contentType);
  return register.metrics();
});
```

---

## Security Hardening

### Database Security

```sql
-- Create read-only user
CREATE USER 'finbridge_ro'@'%' IDENTIFIED BY 'secure_password';
GRANT SELECT ON finbridge_db.* TO 'finbridge_ro'@'%';

-- Enable SSL
ALTER USER 'finbridge_ro'@'%' REQUIRE SSL;

-- Audit
SET GLOBAL general_log = 'ON';
SET GLOBAL log_output = 'TABLE';
```

### Application Security

```typescript
// src/server/index.ts
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';

app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
});

app.register(rateLimit, {
  max: 100, // per window
  timeWindow: '15 minutes',
  keyGenerator: (request) => request.ip,
});
```

### Network Security

- [ ] Use HTTPS/TLS (Let's Encrypt)
- [ ] Restrict database access (VPC/Security Groups)
- [ ] Use private subnets for databases
- [ ] Enable WAF (Web Application Firewall)
- [ ] Use DDoS protection (Cloudflare, AWS Shield)
- [ ] IP whitelisting for admin endpoints

---

## Scaling

### Horizontal Scaling

```yaml
# Kubernetes HPA
minReplicas: 2
maxReplicas: 10
cpu: 70%        # Scale up if CPU > 70%
memory: 80%     # Scale up if memory > 80%
```

### Vertical Scaling

```yaml
# Increase resource limits
resources:
  requests:
    memory: "512Mi"
    cpu: "500m"
  limits:
    memory: "1Gi"
    cpu: "1000m"
```

### Database Optimization

- [ ] Add database read replicas (for scaling reads)
- [ ] Increase connection pool size
- [ ] Add indices on frequently queried columns
- [ ] Implement query result caching
- [ ] Use CDN for static assets

### Cache Optimization

```bash
# Monitor Redis memory
redis-cli INFO memory

# Optimize via LRU eviction
redis-cli CONFIG SET maxmemory-policy allkeys-lru

# Monitor hit rate
redis-cli INFO stats
```

---

## Backup & Recovery

### Automated Backups

```bash
# Daily backup to S3
0 2 * * * mysqldump -h production-db.example.com -u admin -p finbridge_db | \
  gzip | \
  aws s3 cp - s3://finbridge-backups/db-$(date +\%Y\%m\%d).sql.gz

# Backup retention (30 days)
aws s3api put-bucket-lifecycle-configuration \
  --bucket finbridge-backups \
  --lifecycle-configuration '{
    "Rules": [{
      "Expiration": {"Days": 30},
      "Status": "Enabled",
      "Prefix": "db-"
    }]
  }'
```

### Point-in-Time Recovery

```bash
# With AWS RDS
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier finbridge-restored \
  --db-snapshot-identifier finbridge-backup-20231215

# Enable binary logging for PITR
ALTER TABLE mysql.user MODIFY authentication_string VARCHAR(255);
SET GLOBAL binlog_format = 'ROW';
```

### Disaster Recovery Plan

| Scenario | RTO | RPO | Action |
|----------|-----|-----|--------|
| App crash | 5 min | 0 min | K8s auto-restart |
| DB failure | 30 min | 5 min | RDS failover |
| Data corruption | 1 hour | 1 hour | Restore from snapshot |
| Region outage | 4 hours | 1 hour | Failover to DR region |

---

## Troubleshooting

### App not starting

```bash
# Check logs
kubectl logs deployment/finbridge-mcp -n finbridge

# Check environment variables
kubectl exec pod/finbridge-mcp-xyz -n finbridge -- env | grep DB_

# Check database connectivity
kubectl exec pod/finbridge-mcp-xyz -n finbridge -- curl http://mysql:3306
```

### Database connection issues

```bash
# Test connection
mysql -h production-db.example.com -u finbridge_user -p finbridge_db -e "SELECT 1;"

# Check connection pool status
curl https://api.finbridge.com/health/info | jq '.database'

# Increase pool size
DB_POOL_SIZE=40 npm start
```

### Performance degradation

```bash
# Check slow queries
SET GLOBAL long_query_time = 1;
SET GLOBAL general_log = 'ON';
SELECT * FROM mysql.general_log ORDER BY event_time DESC LIMIT 20;

# Check Redis memory
redis-cli INFO memory

# Profile application
NODE_OPTIONS='--prof' npm start
# Process profiling: node --prof-process isolate-*.log > profile.txt
```

### High error rate

```bash
# Check error logs
kubectl logs deployment/finbridge-mcp -n finbridge | grep ERROR

# Check rate limiting
kubectl logs deployment/finbridge-mcp -n finbridge | grep 'rate.*limit'

# Check auth failures
curl https://api.finbridge.com/health/info | jq '.auth'
```

---

## Rollback Procedure

### If Deployment Fails

```bash
# Get previous deployment revision
kubectl rollout history deployment/finbridge-mcp -n finbridge

# Rollback to previous version
kubectl rollout undo deployment/finbridge-mcp -n finbridge

# Rollback to specific revision
kubectl rollout undo deployment/finbridge-mcp -n finbridge --to-revision=2
```

### If Database Migration Fails

```bash
# Restore database from backup
mysql -h production-db.example.com -u admin -p finbridge_db < backup_20231215_020000.sql

# For RDS
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier finbridge-prod-restored \
  --db-snapshot-identifier finbridge-backup-20231215
```

---

## Maintenance

### Regular Tasks

| Task | Frequency | Command |
|------|-----------|---------|
| Database backups | Daily | `aws rds create-db-snapshot` |
| Security patches | Weekly | `npm audit fix` |
| Dependency updates | Monthly | `npm update` |
| Log rotation | Daily | Automated by Docker/K8s |
| Database optimization | Quarterly | `OPTIMIZE TABLE` |
| SSL certificate renewal | Monthly | Automated by cert-manager |

---

**Production deployment complete! Monitor closely during first week.** 🚀
