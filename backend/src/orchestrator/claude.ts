import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import { createLogger } from '../lib/logger.js';
import { tools } from './tools.js';
import { dispatchTool } from './tool-dispatcher.js';
import { conversationService } from '../services/conversation.service.js';

const log = createLogger({ service: 'claude-orchestrator' });

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

type Message = Anthropic.MessageParam;

export interface CopilotResult {
  reply: string;
  toolsUsed: string[];
  conversationId: string;
}

const SYSTEM_PROMPT = `You are an AI DevOps Copilot for infrastructure monitoring.
You have access to three tools:
- query_failed_jobs: queries PostgreSQL for failed background jobs
- get_redis_stats: fetches Redis cache performance metrics
- get_aws_costs: queries AWS Cost Explorer for cloud spend data

When answering questions:
- Always query the relevant tool before answering — never guess at data
- If a question spans multiple data sources, call all relevant tools in parallel where possible
- Present findings in plain English with specific numbers and percentages
- Flag anomalies clearly (e.g. hit rate below 80%, sudden cost spikes, burst of failures)
- If a query has no relevant data (e.g. zero failed jobs), say so directly
- Format numbers clearly: "$1,234.56", "78.5% hit rate", "42 failed jobs"
- Reference previous context when relevant (e.g. "As we discussed earlier...")`;

export async function runCopilotQuery(
  userMessage: string,
  conversationId?: string,
): Promise<CopilotResult> {
  // Create new conversation or load existing history
  let convId = conversationId;
  let history: Message[] = [];

  if (convId) {
    // Verify conversation exists
    const conversation = await conversationService.getConversation(convId);
    if (!conversation) {
      log.warn({ conversationId: convId }, 'Conversation not found, creating new one');
      convId = await conversationService.createConversation();
    } else {
      // Load conversation history
      history = await conversationService.getHistory(convId);
    }
  } else {
    // Create new conversation
    convId = await conversationService.createConversation();
  }

  // Save user message
  await conversationService.addMessage(convId, 'user', userMessage);

  const messages: Message[] = [
    ...history,
    { role: 'user', content: userMessage },
  ];

  const toolsUsed: string[] = [];

  // Agentic loop — continues until Claude stops requesting tools
  while (true) {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    log.debug(
      {
        stop_reason: response.stop_reason,
        content_blocks: response.content.length,
        conversation_id: convId,
      },
      'Claude response received',
    );

    // Final answer — no more tool calls
    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find((b) => b.type === 'text');
      const reply = textBlock?.type === 'text' ? textBlock.text : '';
      
      // Save assistant message
      await conversationService.addMessage(
        convId,
        'assistant',
        reply,
        toolsUsed.length > 0 ? toolsUsed : undefined,
      );

      log.info(
        { tools_used: toolsUsed, reply_length: reply.length, conversation_id: convId },
        'Copilot query complete',
      );
      return { reply, toolsUsed, conversationId: convId };
    }

    // Safety guard — unexpected stop reason breaks the loop instead of spinning forever
    if (response.stop_reason !== 'tool_use') {
      log.warn(
        { stop_reason: response.stop_reason, conversation_id: convId },
        'Unexpected stop reason — terminating loop',
      );
      
      const errorReply = 'The response was cut short unexpectedly. Please try rephrasing your question.';
      await conversationService.addMessage(convId, 'assistant', errorReply);
      
      return {
        reply: errorReply,
        toolsUsed,
        conversationId: convId,
      };
    }

    // Append Claude's assistant turn (including tool_use blocks) to history
    const assistantMessage: Message = {
      role: 'assistant',
      content: response.content,
    };
    messages.push(assistantMessage);

    // Execute all tool calls in this turn
    const toolCallBlocks = response.content.filter(
      (b) => b.type === 'tool_use',
    );

    const validResults: Anthropic.Messages.ToolResultBlockParam[] = [];

    for (const block of toolCallBlocks) {
      if (block.type !== 'tool_use') continue;

      log.info({ tool: block.name, input: block.input, conversation_id: convId }, 'Executing tool');
      toolsUsed.push(block.name);

      try {
        const result = await dispatchTool(
          block.name,
          block.input as Record<string, unknown>,
        );
        validResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      } catch (err) {
        log.error({ err, tool: block.name, conversation_id: convId }, 'Tool execution failed');
        validResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
          is_error: true,
        });
      }
    }

    messages.push({ role: 'user', content: validResults });
  }
}
