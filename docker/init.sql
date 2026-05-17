-- ────────────────────────────────────────────────────────────────────────────
-- FinBridge MCP — Development seed schema
-- Applied automatically by Docker Compose on first startup
-- ────────────────────────────────────────────────────────────────────────────

-- Grant readonly permissions to the app user
GRANT SELECT ON finbridge_db.* TO 'finbridge_readonly'@'%';
FLUSH PRIVILEGES;

USE finbridge_db;

-- Transactions
CREATE TABLE IF NOT EXISTS transactions (
  id              VARCHAR(36)    NOT NULL PRIMARY KEY,
  rrn             VARCHAR(64)    NOT NULL,
  user_id         VARCHAR(36)    NOT NULL,
  amount          DECIMAL(18,2)  NOT NULL,
  currency        CHAR(3)        NOT NULL DEFAULT 'NGN',
  status          ENUM('pending','success','failed','reversed','processing') NOT NULL DEFAULT 'pending',
  reference       VARCHAR(128),
  description     TEXT,
  bank_code       VARCHAR(20),
  terminal_id     VARCHAR(50),
  response_code   VARCHAR(10),
  response_message VARCHAR(255),
  card_last4      CHAR(4),
  pan_masked      VARCHAR(20),
  scheme          VARCHAR(20),
  auth_code       VARCHAR(20),
  created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_rrn        (rrn),
  INDEX idx_user_id    (user_id),
  INDEX idx_status     (status),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Payment transactions';

-- Payouts
CREATE TABLE IF NOT EXISTS payouts (
  id             VARCHAR(36)   NOT NULL PRIMARY KEY,
  user_id        VARCHAR(36)   NOT NULL,
  amount         DECIMAL(18,2) NOT NULL,
  currency       CHAR(3)       NOT NULL DEFAULT 'NGN',
  status         ENUM('pending','processing','success','failed','reversed') NOT NULL DEFAULT 'pending',
  bank_code      VARCHAR(20),
  account_number VARCHAR(20),
  account_name   VARCHAR(100),
  reference      VARCHAR(128),
  failure_reason TEXT,
  retry_count    INT            NOT NULL DEFAULT 0,
  created_at     DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_status     (status),
  INDEX idx_user_id    (user_id),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Payout records';

-- Wallets
CREATE TABLE IF NOT EXISTS wallets (
  id                VARCHAR(36)   NOT NULL PRIMARY KEY,
  user_id           VARCHAR(36)   NOT NULL,
  currency          CHAR(3)       NOT NULL DEFAULT 'NGN',
  available_balance DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  ledger_balance    DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  reserved_balance  DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  last_updated_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_currency (user_id, currency)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='User wallet balances';

-- Bank Health
CREATE TABLE IF NOT EXISTS bank_health (
  bank_code           VARCHAR(20)  NOT NULL PRIMARY KEY,
  bank_name           VARCHAR(100) NOT NULL,
  status              ENUM('operational','degraded','outage','maintenance') NOT NULL DEFAULT 'operational',
  success_rate_24h    DECIMAL(5,2) NOT NULL DEFAULT 100.00,
  avg_response_ms     INT          NOT NULL DEFAULT 0,
  total_requests_24h  INT          NOT NULL DEFAULT 0,
  failed_requests_24h INT          NOT NULL DEFAULT 0,
  last_incident_at    DATETIME,
  last_checked_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Bank and PSP health metrics';

-- Settlements
CREATE TABLE IF NOT EXISTS settlements (
  id                VARCHAR(36)   NOT NULL PRIMARY KEY,
  batch_id          VARCHAR(64)   NOT NULL,
  bank_code         VARCHAR(20),
  currency          CHAR(3)       NOT NULL DEFAULT 'NGN',
  total_amount      DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  transaction_count INT           NOT NULL DEFAULT 0,
  fee_amount        DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  net_amount        DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  status            ENUM('pending','processing','settled','failed') NOT NULL DEFAULT 'pending',
  settlement_date   DATETIME      NOT NULL,
  processed_at      DATETIME,
  reference         VARCHAR(128),
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_batch_id       (batch_id),
  INDEX idx_settlement_date (settlement_date),
  INDEX idx_status         (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Settlement batches';

-- Chargebacks (for RRN search includeRelated)
CREATE TABLE IF NOT EXISTS chargebacks (
  id             VARCHAR(36)   NOT NULL PRIMARY KEY,
  transaction_id VARCHAR(36)   NOT NULL,
  rrn            VARCHAR(64)   NOT NULL,
  status         ENUM('open','won','lost','pending') NOT NULL DEFAULT 'open',
  reason         VARCHAR(255),
  amount         DECIMAL(18,2),
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rrn (rrn),
  INDEX idx_transaction_id (transaction_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Chargeback records';

-- Chat Conversations
CREATE TABLE IF NOT EXISTS chat_conversations (
  id         VARCHAR(36)  NOT NULL PRIMARY KEY,
  user_id    VARCHAR(255) NOT NULL,
  title      VARCHAR(255) NOT NULL DEFAULT 'New Chat',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user_id    (user_id),
  INDEX idx_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI chat conversation threads';

-- Chat Messages
CREATE TABLE IF NOT EXISTS chat_messages (
  id              VARCHAR(36)              NOT NULL PRIMARY KEY,
  conversation_id VARCHAR(36)              NOT NULL,
  role            ENUM('user','assistant') NOT NULL,
  content         TEXT                     NOT NULL,
  tool_calls      JSON,
  created_at      DATETIME                 NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_conversation_id (conversation_id),
  FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI chat messages per conversation';

GRANT INSERT, UPDATE, DELETE ON finbridge_db.chat_conversations TO 'finbridge_readonly'@'%';
GRANT INSERT, UPDATE, DELETE ON finbridge_db.chat_messages TO 'finbridge_readonly'@'%';
FLUSH PRIVILEGES;

-- ────────────────────────────────────────────────────────────────────────────
-- AI Memory System Tables
-- Added to support the AI Memory + Semantic Cache + Self-Learning feature.
-- Existing tables above are NOT modified.
-- ────────────────────────────────────────────────────────────────────────────

-- AI Knowledge Base
-- Stores every unique prompt/response pair learned by the system.
-- Indexed on prompt_hash for fast exact-match deduplication.
CREATE TABLE IF NOT EXISTS ai_knowledge (
  id                VARCHAR(36)    NOT NULL PRIMARY KEY,
  original_prompt   TEXT           NOT NULL,
  normalized_prompt TEXT           NOT NULL,
  prompt_hash       VARCHAR(64)    NOT NULL,
  response          LONGTEXT       NOT NULL,
  sql_result        JSON,
  embedding_id      VARCHAR(36),
  hit_count         INT            NOT NULL DEFAULT 0,
  confidence        DECIMAL(4,3)   NOT NULL DEFAULT 1.000,
  intent_category   VARCHAR(100),
  metadata          JSON,
  created_at        DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_prompt_hash    (prompt_hash),
  INDEX idx_normalized_prompt  (normalized_prompt(255)),
  INDEX idx_intent_category    (intent_category),
  INDEX idx_hit_count          (hit_count)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='AI learned knowledge base — one row per unique normalised prompt';

-- AI Chat History
-- Full audit trail of every AI chat interaction, including cache source and latency.
-- Used for training analytics and self-improvement feedback loops.
CREATE TABLE IF NOT EXISTS ai_chat_history (
  id                VARCHAR(36)  NOT NULL PRIMARY KEY,
  user_id           VARCHAR(36)  NOT NULL,
  conversation_id   VARCHAR(36),
  original_prompt   TEXT         NOT NULL,
  normalized_prompt TEXT         NOT NULL,
  prompt_hash       VARCHAR(64)  NOT NULL,
  response          LONGTEXT     NOT NULL,
  cache_hit         TINYINT(1)   NOT NULL DEFAULT 0,
  cache_source      ENUM('none','redis','qdrant','openai') NOT NULL DEFAULT 'none',
  confidence_score  DECIMAL(4,3),
  response_ms       INT          NOT NULL DEFAULT 0,
  tool_calls_count  INT          NOT NULL DEFAULT 0,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ach_user_id      (user_id),
  INDEX idx_ach_prompt_hash  (prompt_hash),
  INDEX idx_ach_created_at   (created_at),
  INDEX idx_ach_cache_source (cache_source)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='AI chat history for training and performance analytics';

-- AI Feedback
-- User thumbs-up / thumbs-down on AI responses.
-- Negative feedback can trigger cache invalidation and knowledge correction.
CREATE TABLE IF NOT EXISTS ai_feedback (
  id               VARCHAR(36)  NOT NULL PRIMARY KEY,
  chat_history_id  VARCHAR(36)  NOT NULL,
  user_id          VARCHAR(36)  NOT NULL,
  rating           TINYINT      NOT NULL COMMENT '1=worst … 5=best',
  feedback_type    ENUM('positive','negative','neutral') NOT NULL DEFAULT 'neutral',
  comment          TEXT,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_af_chat_history_id (chat_history_id),
  INDEX idx_af_user_id         (user_id),
  INDEX idx_af_rating          (rating)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='User feedback on AI responses';

-- AI Cache Logs
-- One row per request — records whether each request hit Redis, Qdrant, or called OpenAI.
-- Used for cache efficiency dashboards and token-cost tracking.
CREATE TABLE IF NOT EXISTS ai_cache_logs (
  id           VARCHAR(36)  NOT NULL PRIMARY KEY,
  prompt_hash  VARCHAR(64)  NOT NULL,
  cache_source ENUM('redis','qdrant','openai') NOT NULL,
  hit          TINYINT(1)   NOT NULL DEFAULT 0,
  confidence   DECIMAL(4,3),
  response_ms  INT          NOT NULL DEFAULT 0,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_acl_prompt_hash  (prompt_hash),
  INDEX idx_acl_cache_source (cache_source),
  INDEX idx_acl_created_at   (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Per-request AI cache performance log';

-- AI Embeddings Metadata
-- Links a knowledge entry to its Qdrant vector point UUID.
-- Allows cross-referencing MySQL knowledge rows with Qdrant storage.
CREATE TABLE IF NOT EXISTS ai_embeddings (
  id           VARCHAR(36)   NOT NULL PRIMARY KEY,
  knowledge_id VARCHAR(36)   NOT NULL,
  qdrant_id    VARCHAR(36)   NOT NULL,
  model        VARCHAR(100)  NOT NULL DEFAULT 'text-embedding-3-small',
  dimensions   INT           NOT NULL DEFAULT 1536,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ae_knowledge_id (knowledge_id),
  INDEX idx_ae_qdrant_id     (qdrant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Embedding metadata linking knowledge rows to Qdrant point IDs';

-- ── AI Rate Limiting ──────────────────────────────────────────────────────────

-- Global AI rate limiting configuration (single-row, admin-controlled at runtime)
CREATE TABLE IF NOT EXISTS ai_rate_config (
  id            INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ai_enabled    TINYINT(1)   NOT NULL DEFAULT 1   COMMENT 'Kill-switch: 0 disables AI for all users',
  hourly_limit  INT          NOT NULL DEFAULT 100  COMMENT 'Max AI requests per user per hour (global default)',
  daily_limit   INT          NOT NULL DEFAULT 1000 COMMENT 'Max AI requests per user per day (global default)',
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by    VARCHAR(36)  NULL     COMMENT 'Admin user_id who last changed this'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Global AI rate limiting configuration';

-- Per-user AI rate limit overrides
CREATE TABLE IF NOT EXISTS ai_user_limits (
  id              INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id         VARCHAR(36)  NOT NULL,
  is_blocked      TINYINT(1)   NOT NULL DEFAULT 0  COMMENT '1 = user cannot make AI requests',
  is_unlimited    TINYINT(1)   NOT NULL DEFAULT 0  COMMENT '1 = premium/enterprise, no rate limits',
  hourly_limit    INT          NULL                 COMMENT 'Override hourly limit; NULL = use global',
  daily_limit     INT          NULL                 COMMENT 'Override daily limit; NULL = use global',
  plan_type       VARCHAR(50)  NOT NULL DEFAULT 'standard' COMMENT 'standard | premium | enterprise',
  block_reason    TEXT         NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by      VARCHAR(36)  NULL,
  UNIQUE KEY uq_aul_user_id  (user_id),
  INDEX idx_aul_is_blocked   (is_blocked)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Per-user AI rate limit overrides (blocks, unlimited plans, custom quotas)';

-- Per-user cumulative AI usage statistics (Redis holds current window; this is historical)
CREATE TABLE IF NOT EXISTS ai_usage_stats (
  id               INT            NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id          VARCHAR(36)    NOT NULL,
  total_requests   BIGINT         NOT NULL DEFAULT 0 COMMENT 'Lifetime total AI requests',
  last_request_at  DATETIME       NULL,
  created_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_aus_user_id        (user_id),
  INDEX idx_aus_last_request_at    (last_request_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Per-user cumulative AI usage statistics';

-- Grant the app user write access to all AI tables
GRANT INSERT, UPDATE, DELETE ON finbridge_db.ai_knowledge     TO 'finbridge_readonly'@'%';
GRANT INSERT, UPDATE, DELETE ON finbridge_db.ai_chat_history  TO 'finbridge_readonly'@'%';
GRANT INSERT, UPDATE, DELETE ON finbridge_db.ai_feedback      TO 'finbridge_readonly'@'%';
GRANT INSERT, UPDATE, DELETE ON finbridge_db.ai_cache_logs    TO 'finbridge_readonly'@'%';
GRANT INSERT, UPDATE, DELETE ON finbridge_db.ai_embeddings    TO 'finbridge_readonly'@'%';
GRANT INSERT, UPDATE, DELETE ON finbridge_db.ai_rate_config   TO 'finbridge_readonly'@'%';
GRANT INSERT, UPDATE, DELETE ON finbridge_db.ai_user_limits   TO 'finbridge_readonly'@'%';
GRANT INSERT, UPDATE, DELETE ON finbridge_db.ai_usage_stats   TO 'finbridge_readonly'@'%';
FLUSH PRIVILEGES;

-- ── Seed data ──────────────────────────────────────────────────────────────────

-- Seed default global rate limit config (single row, id=1)
INSERT IGNORE INTO ai_rate_config (id, ai_enabled, hourly_limit, daily_limit) VALUES (1, 1, 100, 1000);

INSERT IGNORE INTO bank_health (bank_code, bank_name, status, success_rate_24h, avg_response_ms, total_requests_24h, failed_requests_24h) VALUES
  ('GTB',     'Guaranty Trust Bank',   'operational', 99.87, 312,  45820, 60),
  ('ACCESS',  'Access Bank',           'operational', 98.92, 485,  32100, 353),
  ('ZENITH',  'Zenith Bank',           'degraded',    95.20, 1240, 28450, 1370),
  ('UBA',     'United Bank for Africa','operational', 99.10, 380,  19800, 178),
  ('PAYSTACK','Paystack',              'operational', 99.98, 180,  88000, 17),
  ('FLUTTERWAVE','Flutterwave',        'operational', 99.75, 220, 102000, 255);
