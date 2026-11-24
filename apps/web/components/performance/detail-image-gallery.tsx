import type { PerformanceDetailImage } from '@grabit/shared';
import type { VisibleCopy } from '@/lib/i18n/visible-copy';

const TICKET_GUIDE_URL = 'https://cdn.heygrabit.com/performance-detail/fa84f968-a3b5-493a-9af2-7cf198879df2.png';
// This published artwork already contains the full guide between its seat map and directions.
const GIRL_RULES_COMPOSITE_URL = 'https://cdn.heygrabit.com/performance-detail/126f35ed-8228-40f8-a501-944334e64a28.png';

interface DetailImageGalleryProps {
  images?: readonly PerformanceDetailImage[] | null;
  title: string;
  copy: VisibleCopy['performance'];
}

export function DetailImageGallery({ images, title, copy }: DetailImageGalleryProps) {
  const eventImages = (images ?? []).filter((image) => image.imageUrl !== TICKET_GUIDE_URL);
  const hasEmbeddedGuide = eventImages.some((image) => image.imageUrl === GIRL_RULES_COMPOSITE_URL);

  return (
    <section id="detail-images" className="ticket-detail-section">
      <h2>{copy.detailImagesTitle}</h2>
      <div className="ticket-detail-images">
        {eventImages.map((image, index) => (
          <img
            key={`${image.imageUrl}-${index}`}
            src={image.imageUrl}
            alt={image.altText || copy.detailImageAlt.replace('{title}', title).replace('{index}', String(index + 1))}
            loading={index === 0 ? 'eager' : 'lazy'}
          />
        ))}
        {!hasEmbeddedGuide && (
          <img
            src={TICKET_GUIDE_URL}
            alt={copy.ticketGuideAlt}
            width={1000}
            height={1984}
            loading={eventImages.length === 0 ? 'eager' : 'lazy'}
          />
        )}
      </div>
    </section>
  );
}
