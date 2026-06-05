import { getLocale } from 'next-intl/server';
import termsMd from '@/content/legal/terms-of-service.md?raw';
import termsEnMd from '@/content/legal/terms-of-service.en.md?raw';
import { LegalFallbackLabel } from '@/components/legal/legal-fallback-label';
import { TermsMarkdown } from '@/components/legal/terms-markdown';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';
import { getLegalRobots } from '../robots';

export const dynamic = 'force-static';

/**
 * Phase 16 review HIGH-4 (codex) — preview/staging 환경 noindex 강제.
 * D-12 의 "검색 엔진 색인 허용" lock 은 prod 기준. placeholder leak 위험 기간 동안
 * preview/non-prod 환경이 색인되지 않도록 환경 변수로 분기.
 * GRABIT_ENV: 'production' | 'preview' | 'development' | undefined.
 * GRABIT_ENV 가 누락된 production build 는 NODE_ENV=production 을 fallback 으로 사용한다.
 */
export async function generateMetadata() {
  const locale = await getLocale();
  const copy = getVisibleCopy(locale).metadata.legal;

  return {
    title: copy.termsTitle,
    description: copy.termsDescription,
    alternates: {
      canonical: 'https://heygrabit.com/legal/terms',
    },
    robots: getLegalRobots(),
  };
}

export default async function TermsPage() {
  const locale = await getLocale();
  const fallbackLocale = locale === 'th' || locale === 'zh-CN' ? locale : null;
  const markdown = locale === 'en' || fallbackLocale ? termsEnMd : termsMd;

  return (
    <>
      {fallbackLocale ? <LegalFallbackLabel locale={fallbackLocale} /> : null}
      <TermsMarkdown showH1>{markdown}</TermsMarkdown>
    </>
  );
}
