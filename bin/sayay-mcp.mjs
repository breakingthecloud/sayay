#!/usr/bin/env node
import { SayayMcpServer, configFromEnv } from '../dist/adapters/mcp.js';

const server = new SayayMcpServer(configFromEnv());

server.run().catch((err) => {
  process.stderr.write(`[sayay-mcp] ${err?.message || err}\n`);
  process.exit(1);
});
