/** Formats a Paystack amount (minor units, e.g. kobo) as currency: 500000 NGN → "₦5,000". */
export function formatMoney(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency,
    maximumFractionDigits: amountMinor % 100 === 0 ? 0 : 2,
  }).format(amountMinor / 100);
}

const INTERVAL_LABEL: Record<string, string> = {
  hourly: "hour",
  daily: "day",
  weekly: "week",
  monthly: "month",
  quarterly: "quarter",
  biannually: "6 months",
  annually: "year",
};

export const intervalLabel = (interval: string) => INTERVAL_LABEL[interval] ?? interval;

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
}
