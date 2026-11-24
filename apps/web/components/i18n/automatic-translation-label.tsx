import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';

import { getVisibleCopy } from '@/lib/i18n/visible-copy';

interface AutomaticTranslationLabelProps {
  locale?: string;
  className?: string;
}

export function AutomaticTranslationLabel({
  locale = 'ko',
  className,
}: AutomaticTranslationLabelProps) {
  const label = getVisibleCopy(locale).performance.reviewedTranslation;

  return (
    <Badge
      variant="outline"
      className={cn(
        'inline-flex w-fit flex-wrap gap-x-1 gap-y-0.5 border-transparent bg-[#F3EFFF] text-[#6C3CE0]',
        className,
      )}
    >
      {label}
    </Badge>
  );
}
