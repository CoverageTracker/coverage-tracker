export type RangeKey = '15m' | '1h' | '12h' | '1d' | '7d' | '30d';

export const RANGE_KEYS: RangeKey[] = ['15m', '1h', '12h', '1d', '7d', '30d'];

export const RANGE_SECONDS: Record<RangeKey, number> = {
  '15m': 15 * 60,
  '1h': 60 * 60,
  '12h': 12 * 60 * 60,
  '1d': 24 * 60 * 60,
  '7d': 7 * 24 * 60 * 60,
  '30d': 30 * 24 * 60 * 60,
};

/** Windows shorter than this use raw per-run precision instead of day-collapsed rollups. */
export const SUB_DAY_THRESHOLD_SECONDS = RANGE_SECONDS['1d'];

export function isRangeKey(value: string): value is RangeKey {
  return (RANGE_KEYS as string[]).includes(value);
}
