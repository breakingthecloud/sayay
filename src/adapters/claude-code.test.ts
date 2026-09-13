import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  estimateCostFromUsage,
  sessionCostFromTranscript,
  ClaudeCodeGuard,
  readHookInput,
} from './claude-code.js';

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe('estimateCostFromUsage', () => {
  it('computes cost from token usage (default sonnet pricing)', () => {
    const cost = estimateCostFromUsage({ input_tokens: 1_000_000, output_tokens: 1_000_000 });
    expect(cost).toBeCloseTo(18, 5);
  });

  it('applies cache read and write factors', () => {
    const cost = estimateCostFromUsage({
      input_tokens: 0,
      cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: 1_000_000,
      output_tokens: 0,
    });
    expect(cost).toBeCloseTo(0.3 + 3.75, 5);
  });

  it('picks model prices by name', () => {
    const cost = estimateCostFromUsage(
      { input_tokens: 0, output_tokens: 1_000_000 },
      { input: 15, output: 75, cacheReadFactor: 0.1, cacheWriteFactor: 1.25 },
    );
    expect(cost).toBeCloseTo(75, 5);
  });
});

describe('sessionCostFromTranscript', () => {
  it('sums costUSD and estimated usage across assistant entries', () => {
    const dir = tempDir('sayay-claude-');
    const path = join(dir, 'session.jsonl');
    writeFileSync(
      path,
      [
        JSON.stringify({ type: 'user', message: { content: 'hi' } }),
        JSON.stringify({
          type: 'assistant',
          model: 'claude-sonnet-4',
          message: { usage: { input_tokens: 1_000_000, output_tokens: 0 } },
        }),
        JSON.stringify({
          type: 'assistant',
          model: 'claude-opus-4',
          message: { usage: { input_tokens: 0, output_tokens: 1_000_000, costUSD: 75 } },
        }),
      ].join('\n'),
      'utf8',
    );
    expect(sessionCostFromTranscript(path)).toBeCloseTo(3 + 75, 5);
    rmSync(dir, { recursive: true, force: true });
  });

  it('skips malformed lines', () => {
    const dir = tempDir('sayay-claude-');
    const path = join(dir, 'session.jsonl');
    writeFileSync(path, 'not-json\n\n{"type":"assistant","message":{"usage":{"costUSD":1}}}\n', 'utf8');
    expect(sessionCostFromTranscript(path)).toBeCloseTo(1, 5);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('ClaudeCodeGuard', () => {
  it('records the session delta and blocks over the daily budget', async () => {
    const dir = tempDir('sayay-claude-');
    const guard = new ClaudeCodeGuard({ budget: { dailyUsd: 10 }, storageFile: join(dir, 'ledger.json'), userId: 'u1' });
    expect((await guard.haltCheck(12)).action).toBe('block');
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not double-count the same session cost', async () => {
    const dir = tempDir('sayay-claude-');
    const guard = new ClaudeCodeGuard({ budget: { dailyUsd: 10 }, storageFile: join(dir, 'ledger.json'), userId: 'u1' });
    expect((await guard.haltCheck(6)).action).toBe('allow');
    expect((await guard.haltCheck(6)).action).toBe('allow');
    rmSync(dir, { recursive: true, force: true });
  });

  it('resetSessionLedger forces a fresh count from the transcript', async () => {
    const dir = tempDir('sayay-claude-');
    const guard = new ClaudeCodeGuard({ budget: { dailyUsd: 10 }, storageFile: join(dir, 'ledger.json'), userId: 'u1' });
    expect((await guard.haltCheck(9)).action).toBe('warn');
    await guard.resetSessionLedger();
    expect((await guard.haltCheck(9)).action).toBe('block');
    rmSync(dir, { recursive: true, force: true });
  });

  it('caps subagent fan-out per step', async () => {
    const dir = tempDir('sayay-claude-');
    const guard = new ClaudeCodeGuard({
      budget: {},
      storageFile: join(dir, 'ledger.json'),
      userId: 'u1',
      maxSubagentsPerStep: 2,
    });
    expect((await guard.subagentSpawnCheck('s1')).action).toBe('allow');
    expect((await guard.subagentSpawnCheck('s1')).action).toBe('allow');
    expect((await guard.subagentSpawnCheck('s1')).action).toBe('block');
    expect((await guard.subagentSpawnCheck('s2')).action).toBe('allow');
    rmSync(dir, { recursive: true, force: true });
  });

  it('readHookInput parses the hook payload', () => {
    const input = readHookInput('{"hook_event_name":"PreToolUse","transcript_path":"/tmp/x.jsonl","tool_name":"Agent"}');
    expect(input.hook_event_name).toBe('PreToolUse');
    expect(input.transcript_path).toBe('/tmp/x.jsonl');
    expect(input.tool_name).toBe('Agent');
  });
});