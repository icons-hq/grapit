import type { AudienceInterestEvidence, AudienceProfile } from '@grabit/shared';

export interface InterestObservation {
  tagId: string;
  kind: 'view' | 'favorite' | 'checkout' | 'purchase';
  count: number;
  lastAt: string;
}

/** Evidence levels, not probabilities. Reloads on the same KST day count once. */
export function summarizeInterests(observations: InterestObservation[]): Pick<AudienceProfile, 'inferred' | 'purchaseStage'> {
  const tags = new Map<string, AudienceInterestEvidence>();
  let stage: AudienceProfile['purchaseStage'] = 'unknown';
  const order = ['unknown', 'viewed', 'saved', 'checkout', 'purchased'] as const;
  for (const observation of observations) {
    const row = tags.get(observation.tagId) ?? {
      tagId: observation.tagId, level: 'low', viewDays: 0, favorites: 0, checkouts: 0, purchases: 0, lastAt: observation.lastAt,
    };
    const column = { view: 'viewDays', favorite: 'favorites', checkout: 'checkouts', purchase: 'purchases' } as const;
    row[column[observation.kind]] += observation.count;
    row.lastAt = row.lastAt > observation.lastAt ? row.lastAt : observation.lastAt;
    row.level = row.favorites > 0 || row.purchases > 0 ? 'high' : row.viewDays >= 2 || row.checkouts > 0 ? 'medium' : 'low';
    tags.set(row.tagId, row);
    const next = { view: 'viewed', favorite: 'saved', checkout: 'checkout', purchase: 'purchased' } as const;
    if (observation.count > 0 && order.indexOf(next[observation.kind]) > order.indexOf(stage)) stage = next[observation.kind];
  }
  const strength = (r: AudienceInterestEvidence) => Math.min(r.viewDays, 3) + (r.favorites > 0 ? 4 : 0) + (r.checkouts > 0 ? 1 : 0) + (r.purchases > 0 ? 4 : 0);
  return { inferred: [...tags.values()].sort((a, b) => strength(b) - strength(a) || b.lastAt.localeCompare(a.lastAt) || a.tagId.localeCompare(b.tagId)).slice(0, 15), purchaseStage: stage };
}
