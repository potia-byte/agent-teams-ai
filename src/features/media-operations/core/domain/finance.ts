import { currency, ledgerEntry } from './validation';

import type { FinanceReport, LedgerEntry } from '../../contracts';

export function financeReport(
  entries: readonly LedgerEntry[],
  currencyCode: string
): FinanceReport {
  currency.parse(currencyCode);
  const sums = { forecast: 0, accrued: 0, received: 0, expense: 0 };
  for (const value of entries) {
    const entry = ledgerEntry.parse(value);
    if (entry.currency !== currencyCode)
      throw new Error('Mixed currencies require explicit conversion');
    sums[entry.kind] += entry.amount;
    if (!Number.isSafeInteger(sums[entry.kind]))
      throw new Error('Ledger total exceeds safe integer');
  }
  return {
    currency: currencyCode,
    ...sums,
    netProfit: sums.received - sums.expense,
    zeroRevenue: sums.received === 0,
  };
}
