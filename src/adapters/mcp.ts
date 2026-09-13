import { createInterface } from 'node:readline';
import { SayayGuard, FileStorage } from '../index.js';
import type { SayayBudget } from '../index.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOLS: Tool[] = [
  {
    name: 'budget_check',
    description: 'Pre-flight budget check before an expensive agent call.',
    inputSchema: {
      type: 'object',
      properties: {
        estimatedCostUsd: { type: 'number', description: 'Estimated USD cost of the upcoming call' },
        stepId: { type: 'string', description: 'Active step id from budget_step_begin' },
      },
    },
  },
  {
    name: 'budget_record',
    description: 'Record actual spend after an agent call.',
    inputSchema: {
      type: 'object',
      properties: {
        costUsd: { type: 'number', description: 'Actual USD cost of the call' },
        creditsUsed: { type: 'number' },
        stepId: { type: 'string' },
      },
      required: ['costUsd'],
    },
  },
  {
    name: 'budget_summary',
    description: 'Current usage summary for the user.',
    inputSchema: {
      type: 'object',
      properties: {
        stepId: { type: 'string' },
      },
    },
  },
];

export interface SayayMcpConfig {
  budget: SayayBudget;
  storageFile: string;
  userId: string;
}

export class SayayMcpServer {
  private readonly guard: SayayGuard;
  private readonly userId: string;

  constructor(config: SayayMcpConfig) {
    this.guard = new SayayGuard({
      storage: new FileStorage(config.storageFile),
      budget: config.budget,
      onExceeded: 'block',
    });
    this.userId = config.userId;
  }

  async handleLine(line: string): Promise<string | null> {
    if (!line.trim()) return null;
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(line) as JsonRpcRequest;
    } catch {
      return this.error(null, -32700, 'Parse error');
    }
    return this.handle(req);
  }

  async run(): Promise<void> {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    for await (const line of rl) {
      const res = await this.handleLine(line);
      if (res) process.stdout.write(res + '\n');
    }
  }

  private async handle(req: JsonRpcRequest): Promise<string | null> {
    const id = req.id ?? null;
    switch (req.method) {
      case 'initialize':
        return this.result(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'sayay-mcp', version: '0.1.0' },
        });
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return null;
      case 'ping':
        return this.result(id, {});
      case 'tools/list':
        return this.result(id, { tools: TOOLS });
      case 'tools/call':
        return this.callTool(id, req.params as Record<string, unknown>);
      default:
        return this.error(id, -32601, `Method not found: ${req.method}`);
    }
  }

  private async callTool(id: number | string | null, params: Record<string, unknown>): Promise<string> {
    const name = typeof params?.name === 'string' ? params.name : '';
    const args = (params?.arguments as Record<string, unknown>) ?? {};
    let output: unknown;
    try {
      switch (name) {
        case 'budget_check':
          output = await this.budgetCheck(args);
          break;
        case 'budget_record':
          output = await this.budgetRecord(args);
          break;
        case 'budget_summary':
          output = await this.budgetSummary(args);
          break;
        default:
          return this.error(id, -32602, `Unknown tool: ${name}`);
      }
    } catch (err) {
      return this.error(id, -32603, err instanceof Error ? err.message : String(err));
    }
    return this.result(id, {
      content: [{ type: 'text', text: JSON.stringify(output) }],
    });
  }

  private async budgetCheck(args: Record<string, unknown>): Promise<unknown> {
    const estimatedCostUsd = typeof args.estimatedCostUsd === 'number' ? args.estimatedCostUsd : undefined;
    const stepId = typeof args.stepId === 'string' ? args.stepId : undefined;
    return this.guard.check(this.userId, estimatedCostUsd, stepId ? { stepId } : undefined);
  }

  private async budgetRecord(args: Record<string, unknown>): Promise<unknown> {
    const costUsd = typeof args.costUsd === 'number' ? args.costUsd : 0;
    const creditsUsed = typeof args.creditsUsed === 'number' ? args.creditsUsed : undefined;
    const stepId = typeof args.stepId === 'string' ? args.stepId : undefined;
    await this.guard.record(this.userId, costUsd, creditsUsed, stepId ? { stepId } : undefined);
    return { ok: true, usage: await this.guard.getUsage(this.userId, stepId ? { stepId } : undefined) };
  }

  private async budgetSummary(args: Record<string, unknown>): Promise<unknown> {
    const stepId = typeof args.stepId === 'string' ? args.stepId : undefined;
    return this.guard.getUsage(this.userId, stepId ? { stepId } : undefined);
  }

  private result(id: number | string | null, result: unknown): string {
    return JSON.stringify({ jsonrpc: '2.0', id, result });
  }

  private error(id: number | string | null, code: number, message: string): string {
    return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
  }
}

export function configFromEnv(env: Record<string, string | undefined> = process.env): SayayMcpConfig {
  const num = (v: string | undefined): number | undefined => (v !== undefined && v !== '' ? Number(v) : undefined);
  return {
    budget: {
      dailyUsd: num(env.SAYAY_BUDGET_DAILY),
      monthlyUsd: num(env.SAYAY_BUDGET_MONTHLY),
      sessionUsd: num(env.SAYAY_BUDGET_SESSION),
      perCallMaxUsd: num(env.SAYAY_BUDGET_PER_CALL),
      burnRateUsdPerMin: num(env.SAYAY_BUDGET_BURN_RATE),
      perStepCapUsd: num(env.SAYAY_BUDGET_PER_STEP),
      maxLoopRepeats: num(env.SAYAY_MAX_LOOP_REPEATS),
    },
    storageFile: env.SAYAY_STORAGE_FILE || '.sayay/ledger.json',
    userId: env.SAYAY_USER || 'mcp-user',
  };
}