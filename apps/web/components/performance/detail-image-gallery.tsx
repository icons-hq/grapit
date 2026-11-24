import type { PerformanceDetailImage, SupportedLocale } from '@grabit/shared';
import { TicketEntryGuide } from './ticket-entry-guide';
import { getVisibleCopy, type VisibleCopy } from '@/lib/i18n/visible-copy';

const TICKET_GUIDE_URL = 'https://cdn.heygrabit.com/performance-detail/fa84f968-a3b5-493a-9af2-7cf198879df2.png';
// This published artwork already contains the full guide between its seat map and directions.
const GIRL_RULES_COMPOSITE_URL = 'https://cdn.heygrabit.com/performance-detail/126f35ed-8228-40f8-a501-944334e64a28.png';

interface DetailImageGalleryProps {
  images?: readonly PerformanceDetailImage[] | null;
  title: string;
  locale?: SupportedLocale;
  copy: VisibleCopy['performance'];
}

export function DetailImageGallery({ images, title, copy, locale = 'ko' }: DetailImageGalleryProps) {
  const eventImages = (images ?? []).filter((image) => image.imageUrl !== TICKET_GUIDE_URL);
  const hasEmbeddedGuide = eventImages.some((image) => image.imageUrl === GIRL_RULES_COMPOSITE_URL);

  return (
    <section id="detail-images" className="ticket-detail-section">
      <h2>{copy.detailImagesTitle}</h2>
      <div className="ticket-detail-images">
        {eventImages.map((image, index) => {
          const caption = locale === 'ko' ? undefined : image.captions?.[locale];
          const genericAlt = copy.detailImageAlt.replace('{title}', title).replace('{index}', String(index + 1));
          return (
            <figure key={`${image.imageUrl}-${index}`}>
              <img src={image.imageUrl} alt={caption ? genericAlt : image.altText || genericAlt}
                loading={index === 0 ? 'eager' : 'lazy'} />
              {caption && <figcaption className="whitespace-pre-line px-1 py-3 text-sm leading-6">{caption}</figcaption>}
            </figure>
          );
        })}
        {locale === 'ko' && !hasEmbeddedGuide && (
          <img
            src={TICKET_GUIDE_URL}
            alt={copy.ticketGuideAlt}
            width={1000}
            height={1984}
            loading={eventImages.length === 0 ? 'eager' : 'lazy'}
          />
        )}
        <TicketEntryGuide copy={getVisibleCopy(locale).entryGuide} screenReaderOnly={locale === 'ko'} />
      </div>
    </section>
  );
}
