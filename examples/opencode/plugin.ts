import { createSayayOpenCodePlugin } from '@carloscortezcloud/sayay-guard/opencode';

export const plugin = createSayayOpenCodePlugin({
  budget: {
    dailyUsd: Number(process.env.SAYAY_BUDGET_DAILY || 5),
    burnRateUsdPerMin: Number(process.env.SAYAY_BUDGET_BURN_RATE || 1),
    perCallMaxUsd: Number(process.env.SAYAY_BUDGET_PER_CALL || 1),
  },
  storageFile: process.env.SAYAY_STORAGE_FILE || '.sayay/opencode.json',
  userId: process.env.SAYAY_USER || 'dev',
});