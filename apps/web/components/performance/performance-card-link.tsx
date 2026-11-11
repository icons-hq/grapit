import Link from 'next/link';
import type { ReactNode } from 'react';

/** An announcement has no anchor, keyboard navigation, or Next.js prefetch. */
export function PerformanceCardLink({ detailAvailable, href, className, children }: {
  detailAvailable?: boolean; href: string; className?: string; children: ReactNode;
}) {
  if (detailAvailable === false) {
    return <div className={className} aria-disabled="true">{children}</div>;
  }
  return <Link href={href} className={className}>{children}</Link>;
}
