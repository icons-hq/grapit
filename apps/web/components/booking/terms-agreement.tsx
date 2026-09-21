'use client';

import { useState, useCallback, useEffect } from 'react';
import { useLocale } from 'next-intl';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { TermsMarkdown } from '@/components/legal/terms-markdown';
import { LegalFallbackLabel } from '@/components/legal/legal-fallback-label';
import { getCheckoutCopy } from '@/lib/booking/checkout-copy';
import { resolveVisibleCopyLocale } from '@/lib/i18n/visible-copy';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import termsKo from '@/content/legal/terms-of-service.md?raw';
import termsEn from '@/content/legal/terms-of-service.en.md?raw';
import privacyKo from '@/content/legal/privacy-policy.md?raw';
import privacyEn from '@/content/legal/privacy-policy.en.md?raw';

export function TermsAgreement({ performanceId, onAgreementChange }: {
  performanceId: string;
  onAgreementChange: (agreed: boolean) => void;
}) {
  const locale = resolveVisibleCopyLocale(useLocale());
  const copy = getCheckoutCopy(locale);
  const [bookingTerms, setBookingTerms] = useState(false);
  const [privacyNotice, setPrivacyNotice] = useState(false);
  const [document, setDocument] = useState<'terms' | 'privacy' | null>(null);
  const allChecked = bookingTerms && privacyNotice;
  useEffect(() => { onAgreementChange(allChecked); }, [allChecked, onAgreementChange]);
  const handleAllToggle = useCallback((checked: boolean | 'indeterminate') => {
    setBookingTerms(checked === true);
    setPrivacyNotice(checked === true);
  }, []);
  const content = document === 'terms' ? (locale === 'ko' ? termsKo : termsEn) : (locale === 'ko' ? privacyKo : privacyEn);
  const title = document === 'terms' ? copy.bookingTerms : copy.privacy;

  return (
    <section aria-label={copy.terms} className="space-y-4">
      <h2 className="text-base font-semibold">{copy.terms}</h2>
      <div role="group" aria-label={copy.terms} className="space-y-2">
        <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2.5 font-medium">
          <Checkbox checked={allChecked} onCheckedChange={handleAllToggle} aria-label={copy.allTerms} className="mt-0.5" /><span className="text-sm">{copy.allTerms}</span>
        </label>
        {[
          { key: 'terms' as const, label: copy.bookingTerms, checked: bookingTerms, set: setBookingTerms },
          { key: 'privacy' as const, label: copy.privacy, checked: privacyNotice, set: setPrivacyNotice },
        ].map((item) => (
          <div key={item.key} className="flex items-start justify-between gap-3">
            <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2.5">
              <Checkbox checked={item.checked} onCheckedChange={(checked) => item.set(checked === true)} className="mt-0.5" /><span className="text-sm leading-relaxed">{item.label}</span>
            </label>
            <Button variant="ghost" size="sm" className="min-h-11 shrink-0 text-muted-foreground" aria-label={`${item.label} · ${copy.view}`} onClick={() => setDocument(item.key)}>{copy.view}</Button>
          </div>
        ))}
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{copy.policyHelper}</p>
      <a className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4" href={getLocalizedPathname(`/performance/${performanceId}#sales-copy`, locale)} target="_blank" rel="noopener noreferrer">{copy.cancellationPolicy}</a>
      <Dialog open={document !== null} onOpenChange={(open) => { if (!open) setDocument(null); }}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription className="sr-only">{copy.terms}</DialogDescription></DialogHeader>
          {(locale === 'th' || locale === 'zh-CN') && <LegalFallbackLabel locale={locale} />}
          <TermsMarkdown>{content}</TermsMarkdown>
          <DialogFooter><Button onClick={() => setDocument(null)}>{copy.close}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
