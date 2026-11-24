import { useLocale } from 'next-intl';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';
import { Skeleton } from '@/components/ui/skeleton';

export function SectionSkeleton() {
  const label = getVisibleCopy(useLocale()).commonErrors.loadingContent;
  return (
    <div aria-busy="true" aria-label={label}>
      <Skeleton className="h-6 w-[150px] mb-4" />
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex gap-2">
            <Skeleton className="w-[120px] aspect-[2/3]" />
            <div className="space-y-2">
              <Skeleton className="h-3 w-[80px]" />
              <Skeleton className="h-3 w-[60px]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
