import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';

const ENGLISH_FALLBACK = 'Reviewed machine translation';

const LOCALE_COPY: Record<string, string> = {
  ko: 'Reviewed machine translation',
  en: ENGLISH_FALLBACK,
  th: ENGLISH_FALLBACK,
  'zh-CN': ENGLISH_FALLBACK,
};

interface AutomaticTranslationLabelProps {
  locale?: string;
  className?: string;
}

export function AutomaticTranslationLabel({
  locale = 'ko',
  className,
}: AutomaticTranslationLabelProps) {
  const fallbackCopy = LOCALE_COPY[locale] ?? ENGLISH_FALLBACK;

  return (
    <Badge
      variant="outline"
      className={cn(
        'inline-flex w-fit flex-wrap gap-x-1 gap-y-0.5 border-transparent bg-[#F3EFFF] text-[#6C3CE0]',
        className,
      )}
      aria-label="자동 번역 검수본 / Reviewed machine translation"
    >
      <span>자동 번역 검수본</span>
      <span aria-hidden="true">/</span>
      <span>{fallbackCopy}</span>
    </Badge>
  );
}
