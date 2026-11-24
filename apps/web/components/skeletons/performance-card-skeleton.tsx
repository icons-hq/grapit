import { useLocale } from 'next-intl';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';
import { Skeleton } from '@/components/ui/skeleton';

export function PerformanceCardSkeleton() {
  const label = getVisibleCopy(useLocale()).commonErrors.loadingContent;
  return (
    <div aria-busy="true" aria-label={label}>
      <Skeleton className="aspect-[2/3] w-full" />
      <div className="space-y-2 mt-3">
        <Skeleton className="h-4 w-[70%]" />
        <Skeleton className="h-3 w-[50%]" />
        <Skeleton className="h-3 w-[40%]" />
      </div>
    </div>
  );
}
