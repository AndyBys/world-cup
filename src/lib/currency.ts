// Converts the USD pot total into a few friendly currencies. Rates come from
// the free, no-key, CORS-enabled open.er-api.com; if that ever fails we fall
// back to baked-in approximate rates so the UI never breaks.

export interface Currency {
  code: string;
  symbol: string;
  label: string;
}

// The currencies shown alongside the base USD pot.
export const CURRENCIES: Currency[] = [
  { code: 'GBP', symbol: '£', label: 'GBP' },
  { code: 'EUR', symbol: '€', label: 'EUR' },
  { code: 'GEL', symbol: '₾', label: 'Lari' },
];

// Approximate fallback rates per 1 USD (only used if the live fetch fails).
const FALLBACK: Record<string, number> = { GBP: 0.75, EUR: 0.87, GEL: 2.65 };

let ratesCache: Promise<Record<string, number>> | null = null;

export function getRates(): Promise<Record<string, number>> {
  if (!ratesCache) {
    ratesCache = fetch('https://open.er-api.com/v6/latest/USD')
      .then((r) => r.json())
      .then((d) => (d?.result === 'success' && d.rates ? d.rates : FALLBACK))
      .catch(() => FALLBACK);
  }
  return ratesCache;
}

/** Format a USD amount in another currency, e.g. "£60". */
export function convert(usd: number, c: Currency, rates: Record<string, number>): string {
  const rate = rates[c.code] ?? FALLBACK[c.code] ?? 1;
  return `${c.symbol}${Math.round(usd * rate)}`;
}
