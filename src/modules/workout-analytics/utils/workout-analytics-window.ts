/** Exact UTC calendar-day window, including the date containing asOf. */
export function workoutAnalyticsWindow(asOf: Date, days: number): Date {
  const start = new Date(asOf.getTime());
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start;
}
