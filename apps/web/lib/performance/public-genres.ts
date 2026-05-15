import type { EventCategory } from '@grabit/shared';

export const PUBLIC_GENRES = [
  'artist_celebrity',
] as const satisfies readonly EventCategory[];

export type PublicGenre = typeof PUBLIC_GENRES[number];
