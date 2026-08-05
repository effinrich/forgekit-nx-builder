import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { registerScaffoldWorkspaceTool } from './tools/scaffold-workspace.js';
import { registerAddUiLibraryTool } from './tools/add-ui-library.js';
import { registerSetupStorybookTool } from './tools/setup-storybook.js';
import { registerSetupLintFormatTool } from './tools/setup-lint-format.js';
import { registerSetupAuthTool } from './tools/setup-auth.js';
import { registerScaffoldProjectTool } from './tools/scaffold-project.js';

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
  registerAddUiLibraryTool(server);
  registerSetupStorybookTool(server);
  registerSetupLintFormatTool(server);
  registerSetupAuthTool(server);
  registerScaffoldProjectTool(server);

  return server;
}
