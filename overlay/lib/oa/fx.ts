import { one, run } from "./db";
import { normalizeCurrency } from "./money";

export type FxQuote = {
  base: string;
  quote: string;
  requestedDate: string;
  providerDate: string;
  rate: number;
  source: "identity" | "frankfurter";
  cached: boolean;
};

function isoDate(value?: string) {
  const v = value || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error("Invalid FX date");
  return v;
}

function minusDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function getFxQuote(baseInput: string, quoteInput: string, requestedDateInput?: string): Promise<FxQuote> {
  const base = normalizeCurrency(baseInput);
  const quote = normalizeCurrency(quoteInput);
  const requestedDate = isoDate(requestedDateInput);

  if (base === quote) {
    return { base, quote, requestedDate, providerDate: requestedDate, rate: 1, source: "identity", cached: true };
  }

  const cached = await one<{ rate:number; provider_date:string; source:string }>(
    `SELECT rate, provider_date, source FROM oa_fx_rate
     WHERE base_currency=? AND quote_currency=? AND requested_date=?`,
    [base, quote, requestedDate],
  );
  if (cached) {
    return { base, quote, requestedDate, providerDate: cached.provider_date, rate: Number(cached.rate), source: "frankfurter", cached: true };
  }

  let lastError = "rate unavailable";
  for (let i = 0; i < 8; i += 1) {
    const providerDate = minusDays(requestedDate, i);
    const url = `https://api.frankfurter.dev/v2/rate/${encodeURIComponent(base.toLowerCase())}/${encodeURIComponent(quote.toLowerCase())}?date=${providerDate}`;
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) { lastError = `Frankfurter HTTP ${res.status}`; continue; }
      const data = await res.json() as { rate?: number; date?: string };
      const rate = Number(data.rate);
      if (!Number.isFinite(rate) || rate <= 0) { lastError = "Frankfurter returned an invalid rate"; continue; }
      const actualDate = typeof data.date === "string" ? data.date : providerDate;
      await run(
        `INSERT INTO oa_fx_rate(base_currency,quote_currency,requested_date,rate,provider_date,source,fetched_at)
         VALUES(?,?,?,?,?,'frankfurter',CURRENT_TIMESTAMP)
         ON CONFLICT(base_currency,quote_currency,requested_date)
         DO UPDATE SET rate=excluded.rate, provider_date=excluded.provider_date, source=excluded.source, fetched_at=CURRENT_TIMESTAMP`,
        [base, quote, requestedDate, rate, actualDate],
      );
      return { base, quote, requestedDate, providerDate: actualDate, rate, source: "frankfurter", cached: false };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`FX rate unavailable for ${base}/${quote} on ${requestedDate}: ${lastError}`);
}
