export type LegalFallbackLocale = 'ko' | 'en' | 'th' | 'zh-CN';

export const LEGAL_FALLBACK_LABELS: Record<LegalFallbackLocale, string> = {
  ko: '영문 법적 고지로 확인합니다',
  en: 'Reviewing the English legal notice',
  th: 'ตรวจสอบประกาศทางกฎหมายภาษาอังกฤษ',
  'zh-CN': '查看英文法律告知',
};

export function LegalFallbackLabel({ locale }: { locale: LegalFallbackLocale }) {
  const localizedLabel = LEGAL_FALLBACK_LABELS[locale];

  return (
    <p
      className="mb-4 rounded-[4px] border border-[#D8CCFF] bg-[#F3EFFF] px-4 py-3 text-caption font-semibold text-[#6C3CE0]"
      data-legal-fallback-locale={locale}
    >
      <span>영문 법적 고지로 확인합니다</span>
      {localizedLabel !== LEGAL_FALLBACK_LABELS.ko ? (
        <span className="mt-1 block font-normal">{localizedLabel}</span>
      ) : null}
    </p>
  );
}
