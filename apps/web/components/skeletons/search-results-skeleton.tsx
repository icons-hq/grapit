import { useLocale } from 'next-intl';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';
import { Skeleton } from '@/components/ui/skeleton';

export function SearchResultsSkeleton() {
  const label = getVisibleCopy(useLocale()).commonErrors.loadingContent;
  return (
    <div aria-busy="true" aria-label={label}>
      <div className="space-y-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="w-[80px] aspect-[2/3]" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-4 w-[60%]" />
              <Skeleton className="h-3 w-[40%]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
