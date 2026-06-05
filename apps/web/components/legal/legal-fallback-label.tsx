import { getVisibleCopy } from '@/lib/i18n/visible-copy';

export type LegalFallbackLocale = 'ko' | 'en' | 'th' | 'zh-CN';

export function LegalFallbackLabel({ locale }: { locale: LegalFallbackLocale }) {
  const localizedLabel = getVisibleCopy(locale).legal.fallbackLabel;

  return (
    <p
      className="mb-4 rounded-[4px] border border-[#D8CCFF] bg-[#F3EFFF] px-4 py-3 text-caption font-semibold text-[#6C3CE0]"
      data-legal-fallback-locale={locale}
    >
      {localizedLabel}
    </p>
  );
}
