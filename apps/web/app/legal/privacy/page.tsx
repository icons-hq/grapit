import type { Metadata } from 'next';
import { getLocale } from 'next-intl/server';
import type { SupportedLocale } from '@grabit/shared';
import privacyMd from '@/content/legal/privacy-policy.md?raw';
import privacyEnMd from '@/content/legal/privacy-policy.en.md?raw';
import { LegalFallbackLabel } from '@/components/legal/legal-fallback-label';
import { TermsMarkdown } from '@/components/legal/terms-markdown';
import { getLegalRobots } from '../robots';

export const dynamic = 'force-static';

// Phase 16 review HIGH-4: prod 만 index. preview/staging 은 noindex (placeholder 누출 차단)

export const metadata: Metadata = {
  title: '개인정보처리방침 — Grabit',
  description:
    'Grabit이 수집·이용하는 개인정보 항목과 처리 목적, 보유 기간 및 이용자의 권리를 안내합니다.',
  alternates: {
    canonical: 'https://heygrabit.com/legal/privacy',
  },
  robots: getLegalRobots(),
};

export default async function PrivacyPage() {
  const locale = (await getLocale()) as SupportedLocale;
  const usesEnglishFallback = locale === 'th' || locale === 'zh-CN' || locale === 'ja';
  const markdown = locale === 'en' || usesEnglishFallback ? privacyEnMd : privacyMd;

  return (
    <>
      {usesEnglishFallback ? <LegalFallbackLabel locale={locale} /> : null}
      <TermsMarkdown showH1>{markdown}</TermsMarkdown>
    </>
  );
}
