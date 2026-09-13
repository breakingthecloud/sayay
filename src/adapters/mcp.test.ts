import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SayayMcpServer } from './mcp.js';

describe('SayayMcpServer', () => {
  function server(budget: Record<string, number>) {
    const dir = mkdtempSync(join(tmpdir(), 'sayay-mcp-'));
    const s = new SayayMcpServer({ budget, storageFile: join(dir, 'ledger.json'), userId: 'u1' });
    return { s, dir };
  }

  async function call(s: SayayMcpServer, method: string, params?: Record<string, unknown>) {
    const res = await s.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }));
    return res ? (JSON.parse(res) as Record<string, unknown>) : null;
  }

  it('initializes and lists tools', async () => {
    const { s, dir } = server({ dailyUsd: 10 });
    const init = await call(s, 'initialize');
    expect((init as any).result.serverInfo.name).toBe('sayay-mcp');
    const list = await call(s, 'tools/list');
    const tools = ((list as any).result.tools as { name: string }[]).map((t) => t.name);
    expect(tools).toEqual(['budget_check', 'budget_record', 'budget_summary']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('budget_record then budget_check blocks over the daily cap', async () => {
    const { s, dir } = server({ dailyUsd: 5 });
    await call(s, 'tools/call', { name: 'budget_record', arguments: { costUsd: 5 } });
    const res = await call(s, 'tools/call', { name: 'budget_check', arguments: { estimatedCostUsd: 1 } });
    const decision = JSON.parse((res as any).result.content[0].text as string);
    expect(decision.action).toBe('block');
    rmSync(dir, { recursive: true, force: true });
  });

  it('budget_summary returns usage', async () => {
    const { s, dir } = server({ dailyUsd: 5 });
    await call(s, 'tools/call', { name: 'budget_record', arguments: { costUsd: 1.5 } });
    const res = await call(s, 'tools/call', { name: 'budget_summary', arguments: {} });
    const summary = JSON.parse((res as any).result.content[0].text as string);
    expect(summary.daily).toBeCloseTo(1.5, 5);
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns method not found for unknown rpc methods', async () => {
    const { s, dir } = server({ dailyUsd: 5 });
    const res = await call(s, 'bogus');
    expect((res as any).error.code).toBe(-32601);
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns parse error for malformed json', async () => {
    const { s, dir } = server({ dailyUsd: 5 });
    const res = await s.handleLine('{nope');
    expect((JSON.parse(res!) as any).error.code).toBe(-32700);
    rmSync(dir, { recursive: true, force: true });
  });
});