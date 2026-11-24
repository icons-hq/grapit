import { formatCopy } from '@/lib/i18n/client-copy';
import type { VisibleCopy } from '@/lib/i18n/visible-copy';

const WECORD_INSTAGRAM_USERNAME = 'wecord_official';

export function InstagramSupportLink({ copy }: { copy: VisibleCopy['support'] }) {
  return (
    <a
      href={`https://www.instagram.com/m/${WECORD_INSTAGRAM_USERNAME}`}
      target="_blank"
      rel="noopener noreferrer"
      className="font-semibold underline underline-offset-4"
    >
      {formatCopy(copy.instagramDmLabel, { handle: `@${WECORD_INSTAGRAM_USERNAME}` })}
      <span className="sr-only"> ({copy.opensInNewTab})</span>
    </a>
  );
}
