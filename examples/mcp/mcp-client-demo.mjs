import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const server = spawn('node', [join(root, 'bin', 'sayay-mcp.mjs')], {
  env: {
    ...process.env,
    SAYAY_BUDGET_DAILY: '5',
    SAYAY_USER: 'mcp-demo',
    SAYAY_STORAGE_FILE: '.sayay/mcp-demo.json',
  },
  stdio: ['pipe', 'pipe', 'inherit'],
});

let id = 0;
const pending = new Map();
let buffer = '';

server.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg.error ?? msg.result);
      pending.delete(msg.id);
    }
  }
});

function rpc(method, params) {
  id += 1;
  const myId = id;
  return new Promise((resolve) => {
    pending.set(myId, resolve);
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: myId, method, params }) + '\n');
  });
}

await rpc('initialize');
server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
console.log('tools:', (await rpc('tools/list')).tools.map((t) => t.name));

const recorded = await rpc('tools/call', { name: 'budget_record', arguments: { costUsd: 4 } });
console.log('record:', JSON.parse(recorded.content[0].text));

const checked = await rpc('tools/call', { name: 'budget_check', arguments: { estimatedCostUsd: 2 } });
console.log('check:', JSON.parse(checked.content[0].text));

const summary = await rpc('tools/call', { name: 'budget_summary', arguments: {} });
console.log('summary:', JSON.parse(summary.content[0].text));

server.kill();
