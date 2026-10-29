export const PRODUCT_MODES = [
  'WALK',
  'TRANSJAKARTA',
  'MIKROTRANS',
  'KRL',
  'MRT_JAKARTA',
  'LRT_JAKARTA',
  'LRT_JABODEBEK',
] as const;

export type ProductMode = (typeof PRODUCT_MODES)[number];

export const FEED_PRODUCT_MODE = {
  tj: 'TRANSJAKARTA',
  mikro: 'MIKROTRANS',
  krl: 'KRL',
  mrt: 'MRT_JAKARTA',
  lrtj: 'LRT_JAKARTA',
  lrtjb: 'LRT_JABODEBEK',
} as const satisfies Readonly<Record<string, Exclude<ProductMode, 'WALK'>>>;

export type FeedKey = keyof typeof FEED_PRODUCT_MODE;

const SAFE_ID = /^[A-Za-z0-9_.~-]+$/;

export function namespaceId(
  feed: FeedKey,
  entity: string,
  originalId: string,
): string {
  if (!SAFE_ID.test(entity))
    throw new Error(`Unsafe entity namespace: ${entity}`);
  if (originalId.length === 0) throw new Error('Original ID must not be empty');
  return `tnx:${feed}:${entity}:${encodeURIComponent(originalId)}`;
}

export function originalId(namespacedId: string): string {
  const parts = namespacedId.split(':');
  if (parts.length < 4 || parts[0] !== 'tnx')
    throw new Error(`Not a TRANSUM-IN namespaced ID: ${namespacedId}`);
  return decodeURIComponent(parts.slice(3).join(':'));
}

export function productModeForRouterEntity(input: {
  readonly feedKey: string;
  readonly otpMode: string;
}): ProductMode {
  if (input.otpMode === 'WALK') return 'WALK';
  const mode = FEED_PRODUCT_MODE[input.feedKey as FeedKey];
  if (mode === undefined)
    throw new Error(`Unknown feed namespace: ${input.feedKey}`);
  return mode;
}

export interface ServiceDatePolicy {
  readonly feedKey: FeedKey;
  readonly timezone: 'Asia/Jakarta';
  readonly representativeDate: string;
  readonly applicability: string;
}

export function validateServiceDatePolicies(
  policies: readonly ServiceDatePolicy[],
): readonly string[] {
  const errors: string[] = [];
  const feeds = new Set<FeedKey>();
  const representativeDates = new Set<string>();
  for (const policy of policies) {
    if (feeds.has(policy.feedKey))
      errors.push(`Duplicate feed policy: ${policy.feedKey}`);
    feeds.add(policy.feedKey);
    if (policy.timezone !== 'Asia/Jakarta')
      errors.push(`${policy.feedKey}: timezone must be Asia/Jakarta`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(policy.representativeDate))
      errors.push(`${policy.feedKey}: invalid representative date`);
    representativeDates.add(policy.representativeDate);
    if (policy.applicability.trim().length === 0)
      errors.push(`${policy.feedKey}: applicability must be explicit`);
  }
  for (const feed of Object.keys(FEED_PRODUCT_MODE) as FeedKey[]) {
    if (!feeds.has(feed)) errors.push(`Missing feed policy: ${feed}`);
  }
  if (representativeDates.size > 1)
    errors.push(
      `All feeds require one common representative date; found ${[
        ...representativeDates,
      ]
        .sort()
        .join(', ')}`,
    );
  return errors;
}

export function serviceCalendarApplies(
  calendar: 'DAILY' | 'WEEKDAY' | 'WEEKEND',
  localDay: number,
): boolean {
  if (!Number.isInteger(localDay) || localDay < 0 || localDay > 6)
    throw new Error(`Invalid local weekday: ${localDay}`);
  if (calendar === 'DAILY') return true;
  if (calendar === 'WEEKDAY') return localDay >= 1 && localDay <= 5;
  return localDay === 0 || localDay === 6;
}
