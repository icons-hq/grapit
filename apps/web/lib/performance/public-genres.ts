import type { EventCategory } from '@grabit/shared';

export const PUBLIC_GENRES = [
  'musical', 'concert', 'sports', 'exhibition', 'classic', 'kids_family', 'play',
  'artist_celebrity', 'ip_popup', 'leisure_camping',
] as const satisfies readonly EventCategory[];

export type PublicGenre = typeof PUBLIC_GENRES[number];

export const GENRE_IMAGE: Record<PublicGenre, string> = {
  musical: 'musical', concert: 'concert', sports: 'sports', exhibition: 'exhibition',
  classic: 'classic', kids_family: 'family', play: 'play', artist_celebrity: 'concert',
  ip_popup: 'exhibition', leisure_camping: 'venue',
};
