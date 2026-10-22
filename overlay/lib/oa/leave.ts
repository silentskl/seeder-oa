import { all } from "./db";

function assertDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid date");
}

export async function businessDays(startDate: string, endDate: string, dayPart: "full"|"am"|"pm" = "full") {
  assertDate(startDate); assertDate(endDate);
  const start = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);
  if (end < start) throw new Error("End date must be on or after start date");
  if (dayPart !== "full" && startDate !== endDate) throw new Error("Half-day leave must start and end on the same date");

  const rows = await all<{holiday_date:string}>(
    `SELECT holiday_date FROM oa_holiday WHERE holiday_date BETWEEN ? AND ?`, [startDate, endDate],
  );
  const holidays = new Set(rows.map((r) => r.holiday_date));
  let count = 0;
  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    const iso = d.toISOString().slice(0,10);
    if (dow !== 0 && dow !== 6 && !holidays.has(iso)) count += 1;
  }
  if (dayPart !== "full") count = count > 0 ? 0.5 : 0;
  if (count <= 0) throw new Error("The selected leave period contains no working day");
  return count;
}
