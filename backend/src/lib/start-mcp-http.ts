import { randomUUID } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import type { Server } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { createLogger } from './logger.js';

/**
 * Start an MCP server over Streamable HTTP (stateful, session-based).
 *
 * Each connecting client gets its own session — a fresh McpServer + Transport pair.
 * The server factory is called once per initialization request.
 *
 * Routes exposed:
 *   POST   /mcp  — JSON-RPC requests + SSE streaming responses
 *   GET    /mcp  — SSE stream for an existing session
 *   DELETE /mcp  — Session termination
 */
export function startMcpHttp(
  serverFactory: () => McpServer,
  port: number,
  serviceName: string,
): Server {
  const log = createLogger({ service: serviceName });
  const app = createMcpExpressApp();
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];

    if (typeof sessionId === 'string') {
      // Resume an existing session
      const transport = sessions.get(sessionId);
      if (!transport) {
        res.status(404).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Session not found' },
          id: null,
        });
        return;
      }
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // New session — must be an initialize request
    if (!isInitializeRequest(req.body)) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: first message must be initialize',
        },
        id: null,
      });
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        sessions.set(sid, transport);
        log.info({ sessionId: sid }, 'MCP session initialized');
      },
    });

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) {
        sessions.delete(sid);
        log.info({ sessionId: sid }, 'MCP session closed');
      }
    };

    const server = serverFactory();
    // StreamableHTTPServerTransport getter returns '(() => void) | undefined',
    // which is wider than Transport's exactOptionalPropertyTypes-strict '() => void'.
    // Safe cast — the runtime contract is identical.
    type McpTransport = Parameters<McpServer['connect']>[0];
    await server.connect(transport as unknown as McpTransport);
    await transport.handleRequest(req, res, req.body);
  });

  app.get('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    if (typeof sessionId !== 'string' || !sessions.has(sessionId)) {
      res.status(400).json({ error: 'Invalid or missing session ID' });
      return;
    }
    await sessions.get(sessionId)!.handleRequest(req, res);
  });

  app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    if (typeof sessionId !== 'string' || !sessions.has(sessionId)) {
      res.status(400).json({ error: 'Invalid or missing session ID' });
      return;
    }
    await sessions.get(sessionId)!.handleRequest(req, res);
  });

  const httpServer = createHttpServer(app);
  httpServer.listen(port, '127.0.0.1', () => {
    log.info({ port }, 'MCP HTTP server listening');
  });

  return httpServer;
}
