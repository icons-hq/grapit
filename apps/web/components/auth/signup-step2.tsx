'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import type { ConsentItemKey, RegisterStep2Input } from '@grabit/shared';
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
import termsOfServiceMd from '@/content/legal/terms-of-service.md';
import privacyPolicyMd from '@/content/legal/privacy-policy.md';
import marketingConsentMd from '@/content/legal/marketing-consent.md';
import { TermsMarkdown } from '@/components/legal/terms-markdown';
import { getAuthLaunchCopy } from '@/components/auth/auth-launch-copy';

interface SignupStep2Props {
  onComplete: (data: RegisterStep2Input) => void;
  onBack: () => void;
  defaultValues: RegisterStep2Input | null;
}

// WR-07: LEGAL_CONTENT 키 집합을 타입으로 고정.
//        LegalKey 외 임의 string 이 dialogKey 로 전달되는 경로를 차단하여
//        LEGAL_CONTENT[dialogKey] 의 `?.` 없이 안전한 인덱싱을 가능케 한다.
const LEGAL_CONTENT = {
  termsOfService: { title: '이용약관', content: termsOfServiceMd },
  privacyPolicy: { title: '개인정보처리방침', content: privacyPolicyMd },
  pipaRequired: {
    title: '개인정보 필수 수집 및 이용',
    content: privacyPolicyMd,
  },
  crossBorderTransfer: {
    title: '개인정보 국외이전',
    content: privacyPolicyMd,
  },
  pdpaNotice: {
    title: '태국 PDPA 고지',
    content: privacyPolicyMd,
  },
  piplNotice: {
    title: '중국 PIPL 고지',
    content: privacyPolicyMd,
  },
  marketingConsent: { title: '마케팅 수신 동의', content: marketingConsentMd },
} as const satisfies Record<string, { title: string; content: string }>;

type LegalKey = keyof typeof LEGAL_CONTENT;
type ConsentRowConfig = {
  key: ConsentItemKey;
  label: string;
  required: boolean;
  legalKey: LegalKey;
};

const CONSENT_VERSION = '2026-04-28';
const CONSENT_LANGUAGE = 'ko' as const;
const CROSS_BORDER_REQUIRED_MESSAGE =
  '국외이전 동의가 필요합니다. 동의하지 않으면 가입 또는 팬미팅 예매를 진행할 수 없습니다.';

const CONSENT_ROWS: ConsentRowConfig[] = [
  {
    key: 'terms',
    label: '이용약관 동의',
    required: true,
    legalKey: 'termsOfService',
  },
  {
    key: 'privacy',
    label: '개인정보처리방침 동의',
    required: true,
    legalKey: 'privacyPolicy',
  },
  {
    key: 'pipa_required',
    label: '개인정보 필수 수집 및 이용 동의',
    required: true,
    legalKey: 'pipaRequired',
  },
  {
    key: 'cross_border_transfer',
    label: '개인정보 국외이전 동의',
    required: true,
    legalKey: 'crossBorderTransfer',
  },
  {
    key: 'pdpa_notice',
    label: '태국 PDPA 고지 확인',
    required: true,
    legalKey: 'pdpaNotice',
  },
  {
    key: 'pipl_notice',
    label: '중국 PIPL 고지 확인',
    required: true,
    legalKey: 'piplNotice',
  },
  {
    key: 'marketing',
    label: '마케팅 수신 동의',
    required: false,
    legalKey: 'marketingConsent',
  },
];

function initialChecked(defaultValues: RegisterStep2Input | null) {
  return Object.fromEntries(
    CONSENT_ROWS.map((row) => {
      const defaultItem = defaultValues?.consentItems.find(
        (item) => item.key === row.key,
      );

      if (defaultItem) {
        return [row.key, defaultItem.accepted];
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

export function SignupStep2({ onComplete, onBack, defaultValues }: SignupStep2Props) {
  const authCopy = getAuthLaunchCopy(useLocale());
  const [checkedItems, setCheckedItems] = useState(() => initialChecked(defaultValues));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogKey, setDialogKey] = useState<LegalKey>('termsOfService');

  const allChecked = CONSENT_ROWS.every((row) => checkedItems[row.key]);
  const canProceed = CONSENT_ROWS.filter((row) => row.required).every(
    (row) => checkedItems[row.key],
  );
  const showCrossBorderWarning =
    !checkedItems.cross_border_transfer &&
    CONSENT_ROWS.filter(
      (row) => row.required && row.key !== 'cross_border_transfer',
    ).every((row) => checkedItems[row.key]);

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
      version: CONSENT_VERSION,
      language: CONSENT_LANGUAGE,
      accepted: checkedItems[row.key],
      required: row.required,
      sourceFlow: 'signup' as const,
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
          전체 동의
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
                    {row.label}
                  </label>
                  <div className="flex flex-wrap items-center gap-2 text-caption text-gray-500">
                    <span
                      className={
                        row.required
                          ? 'rounded-full bg-red-50 px-2 py-0.5 font-semibold text-error'
                          : 'rounded-full bg-gray-100 px-2 py-0.5 font-semibold text-gray-500'
                      }
                    >
                      {row.required ? '필수' : '선택'}
                    </span>
                    <span>v{CONSENT_VERSION}</span>
                    <span>{CONSENT_LANGUAGE}</span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleViewTerms(row.legalKey)}
                className="shrink-0 text-caption text-gray-500 underline hover:text-primary"
              >
                보기
              </button>
            </div>
          );
        })}
      </div>

      {showCrossBorderWarning && (
        <p role="alert" className="text-caption text-error">
          {CROSS_BORDER_REQUIRED_MESSAGE}
        </p>
      )}

      <div className="flex gap-3 pt-2">
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="flex-1"
          onClick={onBack}
        >
          이전
        </Button>
        <Button
          type="button"
          size="lg"
          className="flex-1"
          disabled={!canProceed}
          onClick={handleSubmit}
        >
          다음
        </Button>
      </div>

      {/* Terms dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            {/* WR-07: dialogKey 가 LegalKey 로 좁혀져 있어 `?.` 가 불필요. */}
            <DialogTitle>{LEGAL_CONTENT[dialogKey].title}</DialogTitle>
            <DialogDescription className="sr-only">
              {LEGAL_CONTENT[dialogKey].title} 상세 내용
            </DialogDescription>
          </DialogHeader>
          <TermsMarkdown>{LEGAL_CONTENT[dialogKey].content}</TermsMarkdown>
        </DialogContent>
      </Dialog>
    </div>
  );
}
