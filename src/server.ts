import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { registerScaffoldWorkspaceTool } from './tools/scaffold-workspace.js';

export function createServer(): McpServer {
  const server = new McpServer({ name: 'forgekit-reactor', version: '0.1.0' });

  server.registerTool(
    'ping',
    {
      description: 'Health check — confirms the forgekit-reactor MCP server is alive.',
      inputSchema: z.object({}),
    },
    async () => ({
      content: [{ type: 'text', text: 'pong' }],
    }),
  );

  registerScaffoldWorkspaceTool(server);

  return server;
}
