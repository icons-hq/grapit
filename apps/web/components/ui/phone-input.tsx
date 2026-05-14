'use client';

import * as React from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import type { Country, FlagProps, Labels } from 'react-phone-number-input';
import PhoneInputPrimitive, {
  getCountryCallingCode,
  parsePhoneNumber,
} from 'react-phone-number-input';
import flags from 'react-phone-number-input/flags';
import ko from 'react-phone-number-input/locale/ko.json';
import en from 'react-phone-number-input/locale/en.json';
import th from 'react-phone-number-input/locale/th.json';
import zh from 'react-phone-number-input/locale/zh.json';
import 'react-phone-number-input/style.css';
import { DEFAULT_LOCALE, isSupportedLocale, type SUPPORTED_LOCALES } from '@grabit/shared';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/cn';

type PhoneInputProps = Omit<
  React.ComponentProps<'input'>,
  'onChange' | 'value' | 'ref'
> & {
  value: string;
  onChange: (value: string) => void;
  locale?: PhoneInputLocale;
};

type PhoneInputLocale = (typeof SUPPORTED_LOCALES)[number];

type PhoneInputLabelSet = Labels & Record<string, string>;

type CountrySelectCopy = {
  ariaPrefix: string;
  searchPlaceholder: string;
  empty: string;
};

type RawDisplayInputProps = React.ComponentProps<'input'> & {
  rawDisplayCallingCode?: string;
  rawDisplayCountry?: Country;
};

const jaLabels = {
  ...(en as PhoneInputLabelSet),
  country: '国/地域',
  KR: '韓国',
  TH: 'タイ',
  CN: '中国',
  JP: '日本',
  US: 'アメリカ合衆国',
  IS: 'アイスランド',
  ZZ: '国際',
} satisfies PhoneInputLabelSet;

const PHONE_INPUT_LABELS = {
  ko: ko as PhoneInputLabelSet,
  en: en as PhoneInputLabelSet,
  th: th as PhoneInputLabelSet,
  'zh-CN': zh as PhoneInputLabelSet,
  ja: jaLabels,
} as const satisfies Record<PhoneInputLocale, PhoneInputLabelSet>;

const COUNTRY_SELECT_COPY = {
  ko: {
    ariaPrefix: '국가 선택',
    searchPlaceholder: '국가 검색...',
    empty: '일치하는 국가가 없습니다.',
  },
  en: {
    ariaPrefix: 'Phone number country',
    searchPlaceholder: 'Search country...',
    empty: 'No country found.',
  },
  th: {
    ariaPrefix: (th as PhoneInputLabelSet).country ?? 'ประเทศ',
    searchPlaceholder: 'ค้นหาประเทศ...',
    empty: 'ไม่พบประเทศที่ตรงกัน',
  },
  'zh-CN': {
    ariaPrefix: (zh as PhoneInputLabelSet).country ?? '国家',
    searchPlaceholder: '搜索国家/地区...',
    empty: '未找到匹配的国家/地区。',
  },
  ja: {
    ariaPrefix: jaLabels.country,
    searchPlaceholder: '国/地域を検索...',
    empty: '一致する国/地域が見つかりません。',
  },
} as const satisfies Record<PhoneInputLocale, CountrySelectCopy>;

const DEFAULT_COUNTRY_BY_LOCALE = {
  ko: 'KR',
  en: 'KR',
  th: 'TH',
  'zh-CN': 'KR',
  ja: 'KR',
} as const satisfies Record<PhoneInputLocale, Country>;

function resolvePhoneInputLocale(locale: PhoneInputLocale | undefined): PhoneInputLocale {
  return locale && isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;
}

const PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>(
  ({ className, locale, onChange, value, ...props }, ref) => {
    const activeLocale = resolvePhoneInputLocale(locale);
    const labels = PHONE_INPUT_LABELS[activeLocale];
    const countrySelectCopy = COUNTRY_SELECT_COPY[activeLocale];
    const parsedCountry = value ? parsePhoneNumber(value)?.country : undefined;
    const rawDisplayCountry = parsedCountry ?? 'KR';

    return (
      <PhoneInputPrimitive
        ref={ref as never}
        className={cn('flex', className)}
        labels={labels}
        defaultCountry={DEFAULT_COUNTRY_BY_LOCALE[activeLocale]}
        flagComponent={FlagComponent}
        countrySelectComponent={(countrySelectProps) => (
          <CountrySelect
            {...countrySelectProps}
            labels={labels}
            copy={countrySelectCopy}
          />
        )}
        inputComponent={InputComponent}
        smartCaret={false}
        rawDisplayCallingCode={getCountryCallingCode(rawDisplayCountry)}
        rawDisplayCountry={rawDisplayCountry}
        value={value || undefined}
        onChange={(v) => onChange(v ?? '')}
        {...props}
      />
    );
  },
);
PhoneInput.displayName = 'PhoneInput';

const InputComponent = React.forwardRef<
  HTMLInputElement,
  RawDisplayInputProps
>(({ className, onChange, rawDisplayCallingCode, rawDisplayCountry, value, ...props }, ref) => {
  const displayValue =
    typeof value === 'string'
      ? toRawNationalDigits(value, rawDisplayCallingCode, rawDisplayCountry)
      : value;

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    event.currentTarget.value = event.currentTarget.value.replace(/[^0-9]/g, '');
    onChange?.(event);
  }

  return (
    <Input
      {...props}
      ref={ref}
      inputMode="numeric"
      value={displayValue}
      onChange={handleChange}
      className={cn('rounded-s-none rounded-e-lg', className)}
    />
  );
});
InputComponent.displayName = 'InputComponent';

function toRawNationalDigits(
  value: string,
  callingCode: string | undefined,
  country: Country | undefined,
): string {
  let digits = value.replace(/[^0-9]/g, '');

  if (callingCode && digits.startsWith(callingCode)) {
    digits = digits.slice(callingCode.length);
  }

  if (country === 'KR' && digits.startsWith('10')) {
    return `0${digits}`;
  }

  return digits;
}

type CountrySelectOption = {
  label: string;
  value: Country;
};

type CountrySelectProps = {
  disabled?: boolean;
  value: Country;
  onChange: (value: Country) => void;
  options: CountrySelectOption[];
  labels: PhoneInputLabelSet;
  copy: CountrySelectCopy;
};

function CountrySelect({
  disabled,
  value,
  onChange,
  options,
  labels,
  copy,
}: CountrySelectProps) {
  const selectedLabel = value ? labels[value] ?? value : null;
  const selectedCallingCode = value ? getCountryCallingCode(value) : null;
  const selectedDescriptor =
    selectedLabel && selectedCallingCode
      ? `${selectedLabel} +${selectedCallingCode}`
      : selectedLabel;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="flex h-11 min-w-[82px] gap-1 rounded-s-lg rounded-e-none px-3"
          disabled={disabled}
          aria-label={selectedDescriptor ? `${copy.ariaPrefix}: ${selectedDescriptor}` : copy.ariaPrefix}
        >
          <FlagComponent
            country={value}
            countryName={selectedLabel ?? value}
          />
          {selectedCallingCode ? (
            <span className="text-sm tabular-nums text-gray-700">
              +{selectedCallingCode}
            </span>
          ) : null}
          <ChevronsUpDown
            className={cn(
              '-mr-2 h-4 w-4 opacity-50',
              disabled ? 'hidden' : 'opacity-100',
            )}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0">
        <Command>
          <CommandInput placeholder={copy.searchPlaceholder} />
          <CommandList>
            <ScrollArea className="h-72">
              <CommandEmpty>{copy.empty}</CommandEmpty>
              <CommandGroup>
                {options
                  .filter((option): option is CountrySelectOption =>
                    Boolean(option.value),
                  )
                  .map((option) => (
                    <CommandItem
                      className="gap-2"
                      key={option.value}
                      onSelect={() => onChange(option.value)}
                    >
                      <FlagComponent
                        country={option.value}
                        countryName={option.label}
                      />
                      <span className="flex-1 text-sm">{option.label}</span>
                      <span className="text-sm text-gray-500">
                        +{getCountryCallingCode(option.value)}
                      </span>
                      <Check
                        className={cn(
                          'ml-auto h-4 w-4',
                          option.value === value ? 'opacity-100' : 'opacity-0',
                        )}
                      />
                    </CommandItem>
                  ))}
              </CommandGroup>
            </ScrollArea>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function FlagComponent({ country, countryName }: FlagProps) {
  const Flag = flags[country];
  return (
    <span className="flex h-4 w-6 overflow-hidden rounded-sm bg-gray-100">
      {Flag ? <Flag title={countryName} /> : null}
    </span>
  );
}

export { PhoneInput };
export type { PhoneInputProps };
