import { Skeleton } from '@/components/ui/skeleton';

export function BannerSkeleton() {
  return (
    <div
      className="mx-auto mt-3 w-full max-w-[1200px] px-4 md:mt-0 md:max-w-none md:px-0"
      aria-busy="true"
      aria-label="콘텐츠를 불러오는 중입니다"
    >
      <Skeleton className="aspect-[1290/600] w-full rounded-lg md:aspect-auto md:h-[400px] md:rounded-none" />
    </div>
  );
}
