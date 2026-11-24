import { useLocale } from 'next-intl';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';
import { Skeleton } from '@/components/ui/skeleton';

export function ReservationDetailSkeleton() {
  const label = getVisibleCopy(useLocale()).commonErrors.loadingContent;
  return (
    <div aria-busy="true" aria-label={label}>
      <div className="space-y-4">
        <Skeleton className="h-6 w-[50%]" />
        <Skeleton className="h-[200px] w-full" />
        <Skeleton className="h-[200px] w-full" />
      </div>
    </div>
  );
}
