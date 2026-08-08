import { afterEach, describe, expect, it } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './server.js';

describe('forgekit-reactor MCP server', () => {
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
  });

  it('initializes and responds to a ping tool call', async () => {
    const server = createServer();
    client = new Client({ name: 'test-harness', version: '1.0.0' });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const result = await client.callTool({ name: 'ping', arguments: {} });

    expect(result.content).toStrictEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'text', text: 'pong' })]),
    );
  });
});
