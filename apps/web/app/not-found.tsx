import Link from 'next/link';
import { getLocale } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';

export default async function NotFound() {
  const locale = await getLocale();
  const copy = getVisibleCopy(locale).notFound;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 px-4">
      <p className="text-[48px] text-gray-400 mb-6">( ._.)</p>
      <h1 className="text-heading font-semibold text-gray-900">
        {copy.title}
      </h1>
      <p className="text-base text-gray-500 mb-6">
        {copy.description}
      </p>
      <Button asChild>
        <Link href={locale === 'ko' ? '/' : `/${locale}`}>{copy.cta}</Link>
      </Button>
    </main>
  );
}
