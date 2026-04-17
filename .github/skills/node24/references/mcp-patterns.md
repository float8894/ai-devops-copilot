# MCP Patterns — Claude API + Tool Use + Node 24

## Claude API Client

```typescript
// src/orchestrator/claude.ts
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { tools } from './tools.js';
import { dispatchTool } from './tool-dispatcher.js';

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

type Message = Anthropic.MessageParam;

export async function runCopilotQuery(
  userMessage: string,
  history: Message[] = []
): Promise<{ reply: string; toolsUsed: string[] }> {
  const messages: Message[] = [
    ...history,
    { role: 'user', content: userMessage },
  ];

  const toolsUsed: string[] = [];

  // Agentic loop — Claude keeps calling tools until it has enough info
  while (true) {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6', // Latest as of April 2026 — fastest + smartest for agents
      // Use claude-haiku-4-5-20251001 during development to save costs
      // Use claude-sonnet-4-6 for production demos and interviews
      max_tokens: 4096,
      system: `You are an AI DevOps Copilot for infrastructure monitoring.
You have access to tools that query PostgreSQL (job data), Redis (cache stats),
and AWS (cost data). When answering questions:
- Always query the relevant tool before answering — never guess
- If a question spans multiple data sources, call all relevant tools
- Present findings in plain English with specific numbers
- Flag anomalies clearly`,
      tools,
      messages,
    });

    // No more tool calls — final answer
    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find(b => b.type === 'text');
      return {
        reply: textBlock?.type === 'text' ? textBlock.text : '',
        toolsUsed,
      };
    }

    // Guard: stop_reason is not 'tool_use' — e.g. 'max_tokens' or unexpected value
    // Without this the while(true) loop never exits
    if (response.stop_reason !== 'tool_use') {
      logger.warn({ stop_reason: response.stop_reason }, 'Unexpected stop reason — breaking loop');
      return { reply: 'Response was cut short. Please try a shorter question.', toolsUsed };
    }

    // Process tool calls
    if (response.stop_reason === 'tool_use') {
      const assistantMessage: Message = {
        role: 'assistant',
        content: response.content,
      };
      messages.push(assistantMessage);

      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        logger.info({ tool: block.name, input: block.input }, 'Tool called');
        toolsUsed.push(block.name);

        try {
          const result = await dispatchTool(block.name, block.input);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        } catch (err) {
          logger.error({ err, tool: block.name }, 'Tool execution failed');
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
            is_error: true,
          });
        }
      }

      messages.push({ role: 'user', content: toolResults });
    }
  }
}
```

## Tool Definitions (for Claude API — separate from MCP server definitions)

Note: These tool definitions are passed to the Claude API directly.
They are NOT the same as MCP server tool definitions.
The MCP servers define tools for the MCP protocol.
These definitions tell Claude API what tools are available to call.

```typescript
// src/orchestrator/tools.ts
import type Anthropic from '@anthropic-ai/sdk';

export const tools: Anthropic.Tool[] = [
  {
    name: 'query_failed_jobs',
    description:
      'Query PostgreSQL for failed background jobs within a time range. ' +
      'Use this when the user asks about: job failures, task errors, ' +
      'failed processes, background job status, what went wrong, error patterns.',
    input_schema: {
      type: 'object' as const,
      properties: {
        time_range: {
          type: 'string',
          enum: ['1h', '24h', '7d', '30d'],
          description: 'How far back to look for failures',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default 20)',
        },
      },
      required: ['time_range'],
    },
  },
  {
    name: 'get_redis_stats',
    description:
      'Get Redis cache performance statistics including hit rate, memory usage, ' +
      'and connected clients. Use this when the user asks about: cache performance, ' +
      'Redis health, cache hit rate, memory usage, cache anomalies.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_aws_costs',
    description:
      'Query AWS Cost Explorer for cloud spending data. ' +
      'Use this when the user asks about: AWS costs, cloud spend, billing, ' +
      'which services cost the most, cost spikes, budget analysis.',
    input_schema: {
      type: 'object' as const,
      properties: {
        time_range: {
          type: 'string',
          enum: ['7d', '30d', '90d'],
          description: 'Time period for cost analysis',
        },
        group_by: {
          type: 'string',
          enum: ['SERVICE', 'REGION', 'USAGE_TYPE'],
          description: 'How to group the cost breakdown',
        },
      },
      required: ['time_range'],
    },
  },
];
```

## Tool Dispatcher

```typescript
// src/orchestrator/tool-dispatcher.ts
import { McpToolError } from '../errors/index.js';
import { queryFailedJobs } from '../mcp-servers/postgres-tools.js';
import { getRedisStats } from '../mcp-servers/redis-tools.js';
import { getAwsCosts } from '../mcp-servers/aws-tools.js';

type ToolInput = Record<string, unknown>;

export async function dispatchTool(name: string, input: ToolInput): Promise<unknown> {
  switch (name) {
    case 'query_failed_jobs':
      return queryFailedJobs(input);
    case 'get_redis_stats':
      return getRedisStats();
    case 'get_aws_costs':
      return getAwsCosts(input);
    default:
      throw new McpToolError(`Unknown tool: ${name}`, name);
  }
}
```

## Tool Description Rules (Critical for Claude accuracy)

1. Start with the data source explicitly: "Query PostgreSQL...", "Call AWS..."
2. Be specific about what it returns
3. Include trigger phrases: "Use this when the user asks about: X, Y, Z"
4. Ensure zero overlap between tool descriptions
5. If two tools could answer the same question, make the distinction explicit
