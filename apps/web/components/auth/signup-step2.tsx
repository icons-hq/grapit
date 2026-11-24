'use client';

import { useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import {
  CONSENT_DOCUMENT_VERSIONS,
  resolveConsentDocumentLanguage,
  type AuthConsentCaptureItem,
  type ConsentItemKey,
  type ConsentSourceFlow,
  type RegisterStep2Input,
} from '@grabit/shared';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { legalDocuments } from '@/content/legal/documents';
import { TermsMarkdown } from '@/components/legal/terms-markdown';
import { getAuthLaunchCopy } from '@/components/auth/auth-launch-copy';

interface SignupStep2Props {
  onComplete: (data: SignupStep2SubmitData) => void;
  onBack: () => void;
  defaultValues: SignupStep2SubmitData | null;
  sourceFlow?: SignupStep2SourceFlow;
}

const LEGAL_CONTENT = {
  termsOfService: legalDocuments.terms,
  privacyPolicy: legalDocuments.privacy,
  pipaRequired: legalDocuments.privacy,
  marketingConsent: legalDocuments.marketing,
};

type LegalKey = keyof typeof LEGAL_CONTENT;
type SignupStep2SourceFlow = Extract<
  ConsentSourceFlow,
  'signup' | 'social_completion'
>;
export type SignupStep2SubmitData = Omit<RegisterStep2Input, 'consentItems'> & {
  consentItems: AuthConsentCaptureItem[];
};
type ConsentRowConfig = {
  key: keyof typeof CONSENT_DOCUMENT_VERSIONS;
  required: boolean;
  legalKey: LegalKey;
};

// Each row records the version of the document its dialog renders.
const CONSENT_ROWS: ConsentRowConfig[] = [
  {
    key: 'terms',
    required: true,
    legalKey: 'termsOfService',
  },
  {
    key: 'privacy',
    required: true,
    legalKey: 'privacyPolicy',
  },
  {
    key: 'pipa_required',
    required: true,
    legalKey: 'pipaRequired',
  },
  {
    key: 'marketing',
    required: false,
    legalKey: 'marketingConsent',
  },
];

function initialChecked(defaultValues: SignupStep2SubmitData | null, documentLocale: ReturnType<typeof resolveConsentDocumentLanguage>) {
  return Object.fromEntries(
    CONSENT_ROWS.map((row) => {
      const defaultItem = defaultValues?.consentItems.find(
        (item) => item.key === row.key,
      );

      if (defaultItem) {
        return [row.key, defaultItem.version === CONSENT_DOCUMENT_VERSIONS[row.key] && defaultItem.language === documentLocale && defaultItem.accepted];
      }

      if (row.key === 'terms') {
        return [row.key, defaultValues?.termsOfService ?? false];
      }

      if (row.key === 'privacy') {
        return [row.key, defaultValues?.privacyPolicy ?? false];
      }

      if (row.key === 'marketing') {
        return [row.key, defaultValues?.marketingConsent ?? false];
      }

      return [row.key, false];
    }),
  ) as Record<ConsentItemKey, boolean>;
}

export function SignupStep2({
  onComplete,
  onBack,
  defaultValues,
  sourceFlow = 'signup',
}: SignupStep2Props) {
  const authCopy = getAuthLaunchCopy(useLocale());
  const consentCopy = authCopy.consent;
  const documentLocale = resolveConsentDocumentLanguage(authCopy.locale);
  const [checkedItems, setCheckedItems] = useState(() => initialChecked(defaultValues, documentLocale));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogKey, setDialogKey] = useState<LegalKey>('termsOfService');
  const dialogOpenerRef = useRef<HTMLButtonElement | null>(null);

  const allChecked = CONSENT_ROWS.every((row) => checkedItems[row.key]);
  const canProceed = CONSENT_ROWS.filter((row) => row.required).every(
    (row) => checkedItems[row.key],
  );

  function handleSelectAll(checked: boolean) {
    setCheckedItems(
      Object.fromEntries(CONSENT_ROWS.map((row) => [row.key, checked])) as Record<
        ConsentItemKey,
        boolean
      >,
    );
  }

  function handleRowChange(key: ConsentItemKey, checked: boolean) {
    setCheckedItems((current) => ({
      ...current,
      [key]: checked,
    }));
  }

  function handleViewTerms(key: LegalKey) {
    setDialogKey(key);
    setDialogOpen(true);
  }

  function handleSubmit() {
    if (!canProceed) return;
    const consentItems = CONSENT_ROWS.map((row) => ({
      key: row.key,
      version: CONSENT_DOCUMENT_VERSIONS[row.key],
      language: documentLocale,
      accepted: checkedItems[row.key],
      required: row.required,
      sourceFlow,
    }));

    onComplete({
      termsOfService: true,
      privacyPolicy: true,
      marketingConsent: checkedItems.marketing,
      consentItems,
    });
  }

  return (
    <div className="space-y-6">
      {/* Select all */}
      <div className="flex items-center gap-2">
        <Checkbox
          id="select-all"
          checked={allChecked}
          onCheckedChange={(checked) => handleSelectAll(checked === true)}
        />
        <label
          htmlFor="select-all"
          className="cursor-pointer text-base font-semibold text-gray-900"
        >
          {consentCopy.selectAll}
        </label>
      </div>

      <Separator />

      <p className="rounded-lg bg-red-50 px-4 py-3 text-caption text-error">
        {authCopy.form.under14Blocked}
      </p>

      {/* Individual terms */}
      <div className="space-y-4">
        {CONSENT_ROWS.map((row) => {
          const rowId = `consent-${row.key}`;
          const itemCopy = consentCopy.items[row.legalKey];

          return (
            <div
              key={row.key}
              className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 px-4 py-3"
            >
              <div className="flex min-w-0 items-start gap-2">
                <Checkbox
                  id={rowId}
                  checked={checkedItems[row.key]}
                  onCheckedChange={(checked) =>
                    handleRowChange(row.key, checked === true)
                  }
                />
                <div className="min-w-0 space-y-1">
                  <label
                    htmlFor={rowId}
                    className="cursor-pointer text-base text-gray-900"
                  >
                    {itemCopy.label}
                  </label>
                  <div className="flex flex-wrap items-center gap-2 text-caption text-gray-500">
                    <span
                      className={
                        row.required
                          ? 'rounded-full bg-red-50 px-2 py-0.5 font-semibold text-error'
                          : 'rounded-full bg-gray-100 px-2 py-0.5 font-semibold text-gray-500'
                      }
                    >
                      {row.required ? consentCopy.required : consentCopy.optional}
                    </span>
                    <span>v{CONSENT_DOCUMENT_VERSIONS[row.key]}</span>
                    <span>{documentLocale}</span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={(event) => { dialogOpenerRef.current = event.currentTarget; handleViewTerms(row.legalKey); }}
                className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center text-caption text-gray-500 underline hover:text-primary"
              >
                {consentCopy.view}
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex gap-3 pt-2">
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="flex-1"
          onClick={onBack}
        >
          {consentCopy.previous}
        </Button>
        <Button
          type="button"
          size="lg"
          className="flex-1"
          disabled={!canProceed}
          onClick={handleSubmit}
        >
          {consentCopy.next}
        </Button>
      </div>

      {/* Terms dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto" onCloseAutoFocus={(event) => {
          event.preventDefault();
          dialogOpenerRef.current?.focus();
        }}>
          <DialogHeader>
            {/* WR-07: dialogKey 가 LegalKey 로 좁혀져 있어 `?.` 가 불필요. */}
            <DialogTitle>{consentCopy.items[dialogKey].title}</DialogTitle>
            <DialogDescription className="sr-only">
              {`${consentCopy.items[dialogKey].title} ${consentCopy.dialogDescriptionSuffix}`}
            </DialogDescription>
          </DialogHeader>
          <TermsMarkdown>{LEGAL_CONTENT[dialogKey][documentLocale]}</TermsMarkdown>
        </DialogContent>
      </Dialog>
    </div>
  );
}
