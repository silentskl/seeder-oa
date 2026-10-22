const COMMON = ["SGD","USD","IDR","CNY","EUR","GBP","JPY","MYR","AUD","HKD","THB","PHP","VND","KRW","INR","TWD","AED","SAR","CHF","CAD","NZD","SEK","NOK","DKK","PLN","CZK","HUF","TRY","BRL","MXN","ZAR"] as const;

export const COMMON_CURRENCIES = [...COMMON];

export function normalizeCurrency(value: unknown): string {
  const code = String(value ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new Error("Invalid currency code");
  return code;
}

export function currencyDigits(currency: string): number {
  try {
    const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
    return typeof digits === "number" ? digits : 2;
  } catch {
    return 2;
  }
}

export function majorToMinor(value: unknown, currency: string): number {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) throw new Error("Invalid amount");
  const factor = 10 ** currencyDigits(currency);
  const minor = Math.round((n + Number.EPSILON) * factor);
  if (!Number.isSafeInteger(minor)) throw new Error("Amount is too large");
  return minor;
}

export function minorToMajor(minor: number, currency: string): number {
  return minor / 10 ** currencyDigits(currency);
}

export function convertMinor(minor: number, from: string, to: string, rate: number): number {
  const major = minorToMajor(minor, from);
  return majorToMinor(major * rate, to);
}

export function formatMoney(minor: number, currency: string): string {
  const digits = currencyDigits(currency);
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(minorToMajor(minor, currency));
}
