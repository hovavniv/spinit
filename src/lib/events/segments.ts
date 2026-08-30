import type { EventSegment } from './detailTypes';

/**
 * Files rows under their segment, preserving arrival order.
 *
 * The page reads both lists whole in one query (design §2.6) and splits them
 * here rather than running three queries. Ordering is the QUERY's job — this
 * function must never sort, or it silently takes over a decision made in
 * detailDal.ts.
 */
export function splitBySegment<T extends { segment: EventSegment }>(
  rows: T[],
): Record<EventSegment, T[]> {
  const grouped: Record<EventSegment, T[]> = { ceremony: [], reception: [], party: [] };
  for (const row of rows) {
    grouped[row.segment].push(row);
  }
  return grouped;
}
