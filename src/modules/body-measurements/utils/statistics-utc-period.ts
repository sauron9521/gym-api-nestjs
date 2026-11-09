/**
 * First instant of a chart covering the last `days` UTC calendar dates,
 * including the UTC date of `asOf`.
 *
 * UTC setters avoid server-local timezone and DST-dependent boundaries.
 */
export function utcSeriesStart(asOf: Date, days: number): Date {
  const result = new Date(asOf.getTime());
  result.setUTCHours(0, 0, 0, 0);
  result.setUTCDate(result.getUTCDate() - (days - 1));
  return result;
}
