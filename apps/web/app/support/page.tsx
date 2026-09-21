'use client';

import Link from 'next/link';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { Button } from '@/components/ui/button';
import { useLocale } from 'next-intl';

import { useSupportContent } from '@/hooks/use-support-content';
import {
  getVisibleCopy,
  resolveVisibleCopyLocale,
} from '@/lib/i18n/visible-copy';

const SUPPORT_EMAIL = 'wecordofficial_cs@mariannekate.com';

export default function SupportPage() {
  const activeLocale = resolveVisibleCopyLocale(useLocale());
  const messages = getVisibleCopy(activeLocale);
  const copy = messages.support;
  const supportContent = useSupportContent(activeLocale);
  const notices = supportContent.isError
    ? []
    : supportContent.data?.notices ?? [];
  const faqs = supportContent.isError ? [] : supportContent.data?.faqs ?? [];
  const fallbackFaqs = [
    {
      question: copy.fallbackBookingQuestion,
      answer: copy.fallbackBookingAnswer,
    },
    {
      question: copy.fallbackPaymentQuestion,
      answer: copy.fallbackPaymentAnswer,
    },
    {
      question: copy.fallbackRefundQuestion,
      answer: copy.fallbackRefundAnswer,
    },
  ];

  return (
    <main className="mx-auto w-full max-w-[960px] px-4 py-8 md:px-6 md:py-10">
      <header className="border-b border-gray-200 pb-5">
        <h1 className="text-2xl font-semibold text-gray-950">{copy.title}</h1>
        <p className="mt-3 text-sm text-gray-600">
          {copy.contactEmailLabel}{' '}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="font-semibold text-gray-950 hover:underline"
          >
            {SUPPORT_EMAIL}
          </a>
        </p>
        <nav aria-label={copy.legalLinks} className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <Link className="inline-flex min-h-11 items-center underline underline-offset-4" href={getLocalizedPathname('/legal/terms', activeLocale)}>{messages.footer.terms}</Link>
          <Link className="inline-flex min-h-11 items-center underline underline-offset-4" href={getLocalizedPathname('/legal/privacy', activeLocale)}>{messages.footer.privacy}</Link>
        </nav>
      </header>

      {supportContent.isError && <div role="alert" className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><p>{copy.loadError}</p><Button variant="outline" className="mt-3" onClick={() => void supportContent.refetch()}>{messages.commonErrors.retry}</Button></div>}
      <section className="py-6" aria-labelledby="support-notices-heading">
        <h2
          id="support-notices-heading"
          className="text-base font-semibold text-gray-950"
        >
          {copy.noticeHeading}
        </h2>
        <div className="mt-4 space-y-3">
          {supportContent.isLoading ? <p role="status">{copy.loading}</p> : supportContent.isError ? null : notices.length > 0 ? (
            notices.map((notice) => (
              <article
                key={notice.id}
                className="rounded-lg border border-gray-200 bg-white p-4"
              >
                <h3 className="break-words text-sm font-semibold text-gray-950">
                  {notice.title}
                </h3>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-gray-700">
                  {notice.body}
                </p>
              </article>
            ))
          ) : (
            <p className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm leading-6 text-gray-700">
              {copy.emptyNotice}
            </p>
          )}
        </div>
      </section>

      <section
        className="border-t border-gray-200 py-6"
        aria-labelledby="support-faq-heading"
      >
        <h2
          id="support-faq-heading"
          className="text-base font-semibold text-gray-950"
        >
          {copy.faqHeading}
        </h2>
        <div className="mt-4 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
          {(faqs.length > 0 ? faqs : fallbackFaqs).map((faq) => (
            <article key={faq.question} className="p-4">
              <h3 className="break-words text-sm font-semibold text-gray-950">
                {faq.question}
              </h3>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-gray-700">
                {faq.answer}
              </p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
