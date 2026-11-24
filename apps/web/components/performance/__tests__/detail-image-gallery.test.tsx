import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';
import { DetailImageGallery } from '../detail-image-gallery';

const guide = 'https://cdn.heygrabit.com/performance-detail/fa84f968-a3b5-493a-9af2-7cf198879df2.png';
const composite = 'https://cdn.heygrabit.com/performance-detail/126f35ed-8228-40f8-a501-944334e64a28.png';
const copy = getVisibleCopy('ko').performance;

describe('public performance detail images', () => {
  it('renders the guide when the performance has no detail images', () => {
    render(<DetailImageGallery title="새 공연" copy={copy} />);

    const image = screen.getByRole('img', { name: copy.ticketGuideAlt });
    expect(image.getAttribute('src')).toBe(guide);
    expect(image.getAttribute('loading')).toBe('eager');
  });

  it.each(['en', 'th', 'zh-CN'] as const)('shows the localized guide and editorial caption in %s', (locale) => {
    const labels = getVisibleCopy(locale);
    const images = [{ imageUrl: composite, altText: '원본 이미지', sortOrder: 0, captions: { [locale]: labels.entryGuide.mobile } }];
    render(<DetailImageGallery locale={locale} title="Show" copy={labels.performance} images={images} />);
    expect(screen.getByRole('heading', { name: labels.entryGuide.title })).toBeDefined();
    expect(screen.getByRole('heading', { name: labels.entryGuide.restricted })).toBeDefined();
    expect(document.querySelector('figcaption')?.textContent).toBe(labels.entryGuide.mobile);
    expect(document.querySelector('img')?.getAttribute('alt')).not.toContain('원본');
  });

  it.each([
    { saved: ['poster.jpg', 'benefits.png'], visible: ['poster.jpg', 'benefits.png', guide] },
    { saved: [guide, 'poster.jpg', guide], visible: ['poster.jpg', guide] },
    { saved: [composite], visible: [composite] },
    { saved: [composite, guide], visible: [composite] },
  ])('displays the saved artwork in order with one guide: $saved', ({ saved, visible }) => {
    const images = saved.map((imageUrl, sortOrder) => ({ imageUrl, sortOrder }));
    render(<DetailImageGallery images={images} title="공연" copy={copy} />);

    expect(screen.getAllByRole('img').map((image) => image.getAttribute('src'))).toEqual(visible);
  });
});
