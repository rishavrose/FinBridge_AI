/**
 * MCP ↔ OpenAI function-calling converter.
 *
 * Converts MCP tool definitions to OpenAI function schemas and
 * executes an AI conversation with automatic tool dispatching.
 */

import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import { getOpenAiClient } from './client.js';
import { toolRegistry } from '../mcp/registry.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';
import type { McpToolContext, OpenAiFunctionDefinition, Role } from '../types/index.js';

// ─── Analytics response validation ────────────────────────────────────────────

/**
 * Checks if a response is pure placeholder text with no real data.
 *
 * A response is a placeholder only when it is:
 *   (a) empty / blank
 *   (b) a short (< 120 chars) meta-phrase with no numeric data
 *   (c) a clarification request
 *   (d) a trailing "would you like X?" question
 *
 * Responses that START with an intro phrase but then contain actual data
 * (numbers, bullet points, multiple lines) are NOT placeholders.
 * Example — NOT a placeholder:
 *   "Here are the 329 failed payouts:\nTotal: ₹128,500\n..."
 *   "Based on the records, failures are caused by bank timeouts (247/329)."
 */
export function isPlaceholderResponse(response: string): boolean {
  if (!response || response.trim().length === 0) return true;

  const trimmed = response.trim();
  const lower = trimmed.toLowerCase();

  // Responses with actual numeric data — keep regardless of intro phrase
  const hasData =
    /[A-Za-z\s]+:\s*[\d₹$€£,\.]+/.test(trimmed) ||   // "Metric: value" lines
    (/\d/.test(trimmed) && trimmed.split('\n').length >= 2); // multi-line with numbers
  if (hasData) return false;

  // Trailing "would you like / shall I / do you want?" question with no data
  if (
    /would\s+you\s+like|shall\s+i\s+|do\s+you\s+want/i.test(lower) &&
    lower.endsWith('?')
  ) {
    return true;
  }

  // Clarification / more-info requests
  if (
    lower.includes('could you please provide') ||
    lower.includes('please provide more detail') ||
    lower.includes('need more information') ||
    lower.includes('could you clarify') ||
    lower.includes('could you specify')
  ) {
    return true;
  }

  // Pure meta-phrases — only flagged when the entire response is short and
  // contains nothing but the filler phrase (no actual data after it)
  const pureMetaPhrases = [
    'please summarize',
    'let me summarize',
    'to summarize',
    'in summary',
    'let me analyze',
    "i'll analyze",
    'i will analyze',
    'summarize the results',
  ];

  if (trimmed.length < 120) {
    for (const ph of pureMetaPhrases) {
      if (lower.includes(ph)) return true;
    }
  }

  return false;
}

/**
 * Final sanity check on the analytics response before returning.
 * Only rejects responses that are purely a one-liner placeholder with no data.
 * Preserves any response — even one starting with an intro phrase — if it
 * contains actual data lines (colons, numbers, bullet points) after the intro.
 */
function validateAndCleanAnalyticsResponse(response: string): string {
  const cleaned = response.trim();
  if (!cleaned) return '';

  // Only reject if the ENTIRE response is a short pure-filler phrase (< 80 chars)
  if (cleaned.length < 80) {
    const pureFiller = [
      /^please\s+(summarize|analyze|provide)\s*\.?\s*$/i,
      /^let\s+me\s+(summarize|analyze)\s*\.?\s*$/i,
      /^to\s+summarize\s*[,:]?\s*$/i,
      /^in\s+summary\s*[,:]?\s*$/i,
      /^here\s+are\s+the\s+results?\s*[:\.]?\s*$/i,
      /^the\s+results?\s+show\s*[:\.]?\s*$/i,
    ];
    for (const pattern of pureFiller) {
      if (pattern.test(cleaned)) {
        logger.warn({ response: cleaned }, 'Pure placeholder response rejected');
        return '';
      }
    }
  }

  return cleaned;
}

/**
 * Last-resort: Extract metrics directly from tool result messages.
 * Parses JSON tool results and extracts numeric values.
 */
function extractMetricsFromMessages(messages: ChatCompletionMessageParam[]): string {
  const metrics: Record<string, string | number> = {};

  // Find all tool result messages
  for (const msg of messages) {
    if (msg.role === 'tool' && typeof msg.content === 'string') {
      try {
        const parsed = JSON.parse(msg.content);

        // Extract data from common response patterns
        if (parsed.data) {
          const data = Array.isArray(parsed.data) ? parsed.data : [parsed.data];

          if (Array.isArray(data)) {
            metrics['Records'] = data.length;
          }

          // Try to extract numeric fields
          if (data.length > 0) {
            const sample = data[0];
            if (typeof sample === 'object' && sample !== null) {
              // Sum numeric fields across all records
              for (const [key] of Object.entries(sample)) {
                const sum = data.reduce((acc: number, item: Record<string, unknown>) => {
                  if (typeof (item as Record<string, unknown>)[key] === 'number') {
                    acc += (item as Record<string, unknown>)[key] as number;
                  }
                  return acc;
                }, 0);
                if (sum > 0) {
                  metrics[`Total ${key}`] = sum;
                }
              }
            }
          }
        }

        // Also try to extract from direct response structure
        if (typeof parsed === 'object') {
          for (const [key, value] of Object.entries(parsed)) {
            if (typeof value === 'number' || typeof value === 'string') {
              metrics[key] = value;
            }
          }
        }
      } catch {
        // Not JSON, skip
      }
    }
  }

  // Format metrics as response
  if (Object.keys(metrics).length > 0) {
    return Object.entries(metrics)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');
  }

  return 'Unable to extract metrics from tool results';
}

// ─── MCP → OpenAI format ──────────────────────────────────────────────────────

export function mcpToolToOpenAiFunction(
  tool: ReturnType<typeof toolRegistry.listTools>[number],
): OpenAiFunctionDefinition {
  const schema = tool.inputSchema as {
    properties?: Record<string, unknown>;
    required?: string[];
  };

  return {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: 'object',
      properties: schema.properties ?? {},
      required: schema.required ?? [],
    },
  };
}

export function getAllOpenAiFunctions(callerRole: Role): OpenAiFunctionDefinition[] {
  return toolRegistry.listTools(callerRole).map(mcpToolToOpenAiFunction);
}

// ─── Query-type detection ────────────────────────────────────────────────────

/**
 * Returns true if the user is asking an analytical/diagnostic question
 * ("why", "how", "explain", "what caused") rather than requesting a numeric
 * summary ("show", "count", "how many", "list").
 *
 * Used to pick the right retry prompt when the first response is empty.
 */
function isAnalyticalQuery(message: string): boolean {
  return /^\s*(why|how|what\s+(caused|went\s+wrong|is\s+the\s+reason|are\s+the\s+reasons?|is\s+happening)|explain|describe\s+why|analyze\s+why|reason\s+for)/i.test(
    message.trim(),
  );
}

// ─── Chat option types ───────────────────────────────────────────────────────

export interface ChatWithToolsOptions {
  userMessage: string;
  systemPrompt?: string;
  /** Prior conversation turns to inject between the system prompt and the current message */
  conversationHistory?: ChatCompletionMessageParam[];
  callerId: string;
  callerRole: Role;
  callerName?: string;
  maxToolRounds?: number;
}

export interface ToolCallTrace {
  name: string;
  args: Record<string, unknown>;
}

export interface ChatWithToolsResult {
  reply: string;
  toolCallsExecuted: number;
  toolCallsTrace: ToolCallTrace[];
  messages: ChatCompletionMessageParam[];
}

// ─── Fintech system prompt ───────────────────────────────────────────────────

export function getFintechSystemPrompt(): string {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const todayStart = `${today} 00:00:00`;
  const todayEnd   = `${today} 23:59:59`;
  return FINTECH_SYSTEM_PROMPT
    .replace('__TODAY__', today)
    .replace('__TODAY_START__', todayStart)
    .replace('__TODAY_END__', todayEnd);
}

export const FINTECH_SYSTEM_PROMPT = `You are a secure fintech AI assistant connected to business systems through MCP tools.

TODAY'S DATE: __TODAY__ (from __TODAY_START__ to __TODAY_END__)
When the user says "today", use filterRanges with from: "__TODAY_START__" and to: "__TODAY_END__".

AUTHENTICATION NOTE:
The caller is already authenticated and their role is pre-validated by the server. NEVER ask for role confirmation or permission verification — the user's identity and access level have already been established. Proceed directly to fulfilling the request.

TOOL EXECUTION (CRITICAL):
- You MUST call tools for ANY query about business data — payouts, transactions, settlements, balances, etc.
- NEVER respond with placeholder text like "I'll summarize the results", "let me analyze", "based on the tool calls above", etc.
- NEVER say "Please provide more details" — extract actual metrics from the tool data immediately.
- When tools return data, IMMEDIATELY parse it and respond with real calculated values.
- Do NOT ask for confirmation before executing tools.

DATA PARSING & ANALYTICS (CRITICAL):
After tools execute and return data:
1. PARSE the actual numeric values from tool results
2. COMPUTE required metrics (count, sum, average, etc.)
3. Return ONLY real data from the results — NEVER mock/placeholder/sample data
4. If records are missing/zero, return 0 (not "no data available")
5. Format response as: METRIC_NAME: value (e.g., "Failed Payouts: 47")
6. For multiple metrics, format as a compact list
7. NEVER wrap results in explanatory phrases like "Here are the results" or "Based on the data"

TOOL USAGE:
- You have access to dynamic query tools named query_{database}_{table} for all connected databases.
- When a user asks about payouts, transactions, settlements, or any business data, IMMEDIATELY call the appropriate query tool.
- For "failed payouts": use filters {"status": 4} — status codes are numeric: 1=success, 2=initiated, 4=failed/rejected. 6=Processed, 8=reversed.
- For "successful payouts": use filters {"status": 1}.
- For "pending payouts": use filters {"status": 6}.
- For "last N records" use limit and orderDir: "DESC".
- For COUNT or SUM questions ("how many", "total amount", "count and amount"), ALWAYS use the aggregate parameter instead of fetching rows:
  Example — "today's successful payout count and amount":
  { "filters": {"addeddate": "__TODAY__", "status": 1}, "aggregate": {"count": true, "sum": "amount"} }
  The result will be: { "result": { "count": 342, "sum_amount": 1250000.50 } }
  Format this as: "Successful Payouts: 342\nTotal Amount: ₹12,50,000.50"
- Never fetch 1000 rows just to count them — always use aggregate for count/sum queries.
- If a filter query returns 0 results, retry by first fetching a few rows with no filter to discover the actual field values, then re-query with the correct value.
- Always attempt to use a tool before saying data is unavailable.

DATE QUERIES (IMPORTANT):
- The payouts table has indexed columns: addeddate (DATE, e.g. "2026-05-24") and addedtime (TIME, e.g. "14:32:00"). Always prefer these over created_at for payout queries — they are indexed and much faster.
- For "payouts today": use filters: {"addeddate": "__TODAY__"}
- For "payouts on DATE": use filters: {"addeddate": "DATE"} — exact match, no range needed.
- For "payouts between DATE_A and DATE_B": use filterRanges: [{"column": "addeddate", "from": "DATE_A", "to": "DATE_B"}].
- For other tables (transactions, settlements, etc.) that only have created_at (not indexed as a DATE column), use filterRanges on created_at:
  Example: filterRanges: [{"column": "created_at", "from": "2026-05-12 00:00:00", "to": "2026-05-12 23:59:59"}]
- NEVER use filters with exact = match on datetime/timestamp columns — it will always return zero results.
- You can combine filters (for exact matches like status, addeddate) with filterRanges in the same tool call.
- Use a generous limit (e.g. 1000) when the user asks "how many" so you can count all matching records.
- When a question asks for MULTIPLE metrics (e.g. "payout count AND UPI average"), call ALL required tools before composing your answer. Do not stop after the first tool — gather all data first, then write a single consolidated response.

STRICT RULES:

1. ONLY answer queries related to:
   - payouts, UPI transactions, settlements, users, balances, merchants
   - reconciliation, transaction analytics, bank status, reports
   - fintech operations, support queries, business database records

2. NEVER answer unrelated topics (general knowledge, coding, politics, entertainment, etc.).
   Reply: "I am restricted to fintech and connected business data operations only."

3. ONLY use approved MCP tools. NEVER generate fake data or guess values.

4. NEVER execute mutating SQL: DELETE, UPDATE, INSERT, DROP, ALTER, TRUNCATE.

5. ONLY allow safe readonly operations.

6. Never expose: database credentials, API secrets, infrastructure details, server configuration.

7. Response Style — choose based on the question type:
   • QUANTITATIVE queries ("show", "count", "how many", "list", "total"):
     - Format: Metric Name: value (one per line)
     - Include units (count, amount ₹, %)
     - Omit introductory phrases
     Example: "Failed Payouts: 329\nTotal Amount: ₹128,500"
   • ANALYTICAL queries ("why", "how", "explain", "what caused"):
     - Provide a concise narrative explanation
     - Reference specific values/codes from the tool data
     - Use bullet points for multiple causes
     - DO NOT force metric format — a clear sentence is correct here

8. If tool returns empty results, respond: "Records: 0" or the specific metric with value 0.

9. If no specific tool matches the request, use the available query_{database}_{table} tools to find the relevant table — call with limit:3 and no filters first to discover the schema, then re-query with the correct filters. NEVER refuse with "no tool available" — always attempt a query first.

10. Your role is: "AI Middleware Assistant for Fintech Infrastructure"

PRIMARY OBJECTIVE:
Execute tools immediately and return real calculated analytics — never placeholder text.`;

// ─── Agentic chat loop ───────────────────────────────────────────────────────

/**
 * Run an agentic chat conversation that automatically dispatches MCP tools
 * when the model requests them.  Loops until the model returns a plain text
 * response (no more tool calls) or maxToolRounds is reached.
 */
export async function chatWithTools(
  opts: ChatWithToolsOptions,
): Promise<ChatWithToolsResult> {
  const {
    userMessage,
    systemPrompt = getFintechSystemPrompt(),
    conversationHistory = [],
    callerId,
    callerRole,
    callerName,
    maxToolRounds = 10,
  } = opts;

  if (!env.OPENAI_API_KEY) {
    const err = new Error('AI chat requires OPENAI_API_KEY — add it to your .env file');
    (err as NodeJS.ErrnoException & { statusCode?: number }).statusCode = 503;
    throw err;
  }

  const client = getOpenAiClient();

  // Ensure readonly users can still access query tools (all tools are SELECT-only).
  // readonly (level 1) gets promoted to analyst (level 2) for AI chat tool access.
  const effectiveRole: Role = callerRole === 'readonly' ? 'analyst' : callerRole;
  const functions = getAllOpenAiFunctions(effectiveRole);
  const requestId = uuidv4();

  const ctx: McpToolContext = {
    caller: { id: callerId, role: effectiveRole, name: callerName },
    requestId,
    timestamp: new Date(),
  };

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ];

  let toolCallsExecuted = 0;
  const toolCallsTrace: ToolCallTrace[] = [];

  for (let round = 0; round < maxToolRounds; round++) {
    const response = await client.chat.completions.create({
      model: env.OPENAI_MODEL,
      messages,
      tools: functions.map((f) => ({ type: 'function' as const, function: f })),
      tool_choice: 'auto',
      max_completion_tokens: env.OPENAI_MAX_TOKENS,
    });

    const choice = response.choices[0];
    if (!choice) break;

    const assistantMessage = choice.message;
    messages.push(assistantMessage as ChatCompletionMessageParam);

    // No more tool calls — return the final text response
    if (choice.finish_reason !== 'tool_calls' || !assistantMessage.tool_calls?.length) {
      let reply = assistantMessage.content ?? '';

      // If tools were executed, validate that the response contains real data, not placeholder text
      if (toolCallsExecuted > 0) {
        // First, check if this is a placeholder response
        const isPlaceholder = isPlaceholderResponse(reply);

        if (isPlaceholder || !reply) {
          // Placeholder detected OR empty reply — retry with a prompt matched
          // to the query type so we don't ask for "MetricName: value" when
          // the user asked a narrative "why/how/explain" question.
          const analyticsPrompt = isAnalyticalQuery(userMessage)
            ? 'Using ONLY the tool results above, explain the root cause(s) clearly and concisely. ' +
              'Include specific error codes, failure types, counts, and patterns you observe in the data. ' +
              'Do NOT use generic phrases — reference the actual values returned by the tools.'
            : 'You must parse the tool results from above and return the actual numeric metrics/values. ' +
              'Format EXACTLY as: MetricName: value (one metric per line, no explanations). ' +
              'Example format:\nFailed Payouts: 47\nTotal Amount: 1250.50\nAverage UPI: 156.75\n' +
              'Rules: NEVER use placeholder phrases like "summarize", "here are", "based on". ' +
              'ONLY return the actual computed metrics from the tool data.';

          messages.push({
            role: 'user',
            content: analyticsPrompt,
          });

          const summaryResp = await client.chat.completions.create({
            model: env.OPENAI_MODEL,
            messages,
            max_completion_tokens: env.OPENAI_MAX_TOKENS,
          });
          reply = summaryResp.choices[0]?.message?.content ?? '';

          // Validate and clean the response
          reply = validateAndCleanAnalyticsResponse(reply);

          // If still a placeholder after retry, extract metrics manually
          if (isPlaceholderResponse(reply)) {
            reply = extractMetricsFromMessages(messages);
          }
        }
      }

      return { reply, toolCallsExecuted, toolCallsTrace, messages };
    }

    // Execute each requested tool call in parallel
    const toolResults = await Promise.allSettled(
      assistantMessage.tool_calls.map(async (tc) => {
        const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        logger.debug({ tool: tc.function.name, callId: tc.id }, 'OpenAI requested tool call');
        toolCallsTrace.push({ name: tc.function.name, args });

        try {
          const result = await toolRegistry.executeTool(tc.function.name, args, ctx);
          toolCallsExecuted++;
          return { callId: tc.id, name: tc.function.name, result: JSON.stringify(result.data) };
        } catch (err) {
          return {
            callId: tc.id,
            name: tc.function.name,
            result: JSON.stringify({ error: (err as Error).message }),
          };
        }
      }),
    );

    // Append tool results back to conversation
    for (const settled of toolResults) {
      if (settled.status === 'fulfilled') {
        const { callId, result } = settled.value;
        messages.push({
          role: 'tool',
          tool_call_id: callId,
          content: result,
        });
      }
    }
  }

  // Exhausted maxToolRounds — force analytics extraction from the model.
  // Add explicit instruction to parse tool results and return metrics.
  if (toolCallsExecuted > 0) {
    try {
      const analyticsPrompt = isAnalyticalQuery(userMessage)
        ? 'Using ONLY the tool results above, explain the root cause(s) clearly and concisely. ' +
          'Include specific error codes, failure types, counts, and patterns from the data.'
        : 'Parse the tool results above and return the actual numeric metrics/values. ' +
          'Format as: MetricName: value (one per line). ' +
          'Never use placeholder text or ask for clarification. ' +
          'Extract and compute real values only.';

      messages.push({
        role: 'user',
        content: analyticsPrompt,
      });

      const summaryResp = await client.chat.completions.create({
        model: env.OPENAI_MODEL,
        messages,
        tool_choice: 'none',
        max_completion_tokens: env.OPENAI_MAX_TOKENS,
      });
      let reply = summaryResp.choices[0]?.message?.content ?? '';
      reply = validateAndCleanAnalyticsResponse(reply);
      return { reply, toolCallsExecuted, toolCallsTrace, messages };
    } catch {
      // fall through to empty reply
    }
  }

  // Return the last assistant message content (if any), never a user message.
  const lastAssistantMsg = [...messages].reverse().find(
    (m) => typeof m === 'object' && m !== null && 'role' in m && m.role === 'assistant',
  );
  const lastContent =
    lastAssistantMsg && 'content' in lastAssistantMsg
      ? String(lastAssistantMsg.content ?? '')
      : '';

  return { reply: lastContent, toolCallsExecuted, toolCallsTrace, messages };
}
