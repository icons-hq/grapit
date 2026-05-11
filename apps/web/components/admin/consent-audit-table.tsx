'use client';

import { useState, type FormEvent } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export type ConsentAuditLanguage = 'ko' | 'en' | 'th' | 'zh-CN' | 'ja';

export interface ConsentAuditFilters {
  user?: string;
  item?: string;
  version?: string;
  language?: ConsentAuditLanguage;
  from?: string;
  to?: string;
  ip?: string;
}

export interface ConsentAuditRow {
  itemKey: string;
  version: string;
  language: string;
  maskedUser: {
    id: string;
    email: string;
    phone: string;
  };
  maskedIp: string;
  timestamp: string;
  sourceFlow: string;
  accepted: boolean;
}

interface ConsentAuditTableProps {
  auditRows: ConsentAuditRow[];
  isLoading: boolean;
  isError: boolean;
  onSearch: (filters: ConsentAuditFilters) => void;
  onRowOpen: (row: ConsentAuditRow) => void;
}

const LANGUAGE_OPTIONS = [
  { value: 'all', label: '전체 언어' },
  { value: 'ko', label: '한국어' },
  { value: 'en', label: 'English' },
  { value: 'th', label: 'ไทย' },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'ja', label: '日本語' },
] as const;

function compactFilters(filters: ConsentAuditFilters): ConsentAuditFilters {
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== undefined && value !== ''),
  ) as ConsentAuditFilters;
}

function formatDateTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}.${m}.${d} ${h}:${min}`;
}

export function ConsentAuditTable({
  auditRows,
  isLoading,
  isError,
  onSearch,
  onRowOpen,
}: ConsentAuditTableProps) {
  const [user, setUser] = useState('');
  const [item, setItem] = useState('');
  const [version, setVersion] = useState('');
  const [language, setLanguage] = useState<'all' | ConsentAuditLanguage>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [ip, setIp] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSearch(
      compactFilters({
        user: user.trim(),
        item: item.trim(),
        version: version.trim(),
        language: language === 'all' ? undefined : language,
        from,
        to,
        ip: ip.trim(),
      }),
    );
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={handleSubmit}
        className="grid gap-3 rounded-lg bg-white p-4 shadow-sm md:grid-cols-2 xl:grid-cols-4"
      >
        <label className="space-y-1.5 text-sm font-semibold text-gray-700">
          <span>사용자 ID 또는 이메일</span>
          <Input
            value={user}
            onChange={(event) => setUser(event.target.value)}
            placeholder="user_123 또는 admin@example.com"
            aria-label="사용자 ID 또는 이메일"
          />
        </label>
        <label className="space-y-1.5 text-sm font-semibold text-gray-700">
          <span>동의 항목</span>
          <Input
            value={item}
            onChange={(event) => setItem(event.target.value)}
            placeholder="cross_border_transfer"
            aria-label="동의 항목"
          />
        </label>
        <label className="space-y-1.5 text-sm font-semibold text-gray-700">
          <span>버전</span>
          <Input
            value={version}
            onChange={(event) => setVersion(event.target.value)}
            placeholder="2026-04-28"
            aria-label="버전"
          />
        </label>
        <div className="space-y-1.5">
          <label htmlFor="consent-audit-language" className="text-sm font-semibold text-gray-700">
            언어
          </label>
          <Select
            value={language}
            onValueChange={(value) => setLanguage(value as 'all' | ConsentAuditLanguage)}
          >
            <SelectTrigger
              id="consent-audit-language"
              aria-label="언어"
              className="h-11 w-full rounded-lg border-gray-200 bg-white text-base"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="space-y-1.5 text-sm font-semibold text-gray-700">
          <span>시작 시각</span>
          <Input
            type="datetime-local"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            aria-label="시작 시각"
          />
        </label>
        <label className="space-y-1.5 text-sm font-semibold text-gray-700">
          <span>종료 시각</span>
          <Input
            type="datetime-local"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            aria-label="종료 시각"
          />
        </label>
        <label className="space-y-1.5 text-sm font-semibold text-gray-700">
          <span>IP 주소</span>
          <Input
            value={ip}
            onChange={(event) => setIp(event.target.value)}
            placeholder="203.0.113.10"
            aria-label="IP 주소"
          />
        </label>
        <div className="flex items-end">
          <Button type="submit" className="h-11 w-full">
            <Search className="h-4 w-4" />
            조회
          </Button>
        </div>
      </form>

      <div className="rounded-lg bg-white shadow-sm">
        {isError && (
          <div role="alert" className="border-b bg-[#FEF2F2] px-4 py-3 text-sm font-semibold text-[#C62828]">
            정보를 불러오지 못했습니다. 새로고침 후 다시 시도하고, 반복되면 운영자에게 문의하세요.
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow className="bg-[#F5F5F7]">
              <TableHead scope="col" className="text-sm font-semibold text-gray-600">항목</TableHead>
              <TableHead scope="col" className="text-sm font-semibold text-gray-600">버전</TableHead>
              <TableHead scope="col" className="text-sm font-semibold text-gray-600">언어</TableHead>
              <TableHead scope="col" className="text-sm font-semibold text-gray-600">사용자</TableHead>
              <TableHead scope="col" className="text-sm font-semibold text-gray-600">IP</TableHead>
              <TableHead scope="col" className="text-sm font-semibold text-gray-600">시각</TableHead>
              <TableHead scope="col" className="text-sm font-semibold text-gray-600">유입</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading &&
              Array.from({ length: 5 }).map((_, index) => (
                <TableRow key={`consent-audit-skeleton-${index}`} data-testid="consent-audit-skeleton-row">
                  <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-10" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-44" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                </TableRow>
              ))}

            {isLoading && (
              <TableRow>
                <TableCell colSpan={7} className="sr-only">
                  동의 감사 이력을 불러오는 중입니다
                </TableCell>
              </TableRow>
            )}

            {!isLoading && auditRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center">
                  <p className="text-base font-semibold text-gray-900">조회된 동의 감사 이력이 없습니다</p>
                  <p className="mt-1 text-sm text-gray-600">필터 조건을 조정해 다시 조회하세요</p>
                </TableCell>
              </TableRow>
            )}

            {!isLoading &&
              auditRows.map((row) => (
                <TableRow
                  key={`${row.maskedUser.id}-${row.itemKey}-${row.version}-${row.timestamp}`}
                  role="button"
                  tabIndex={0}
                  className="min-h-11 cursor-pointer hover:bg-gray-50"
                  aria-label={`${row.itemKey} 동의 감사 상세 보기`}
                  onClick={() => onRowOpen(row)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onRowOpen(row);
                    }
                  }}
                >
                  <TableCell className="text-sm font-semibold">{row.itemKey}</TableCell>
                  <TableCell className="text-sm text-gray-700">{row.version}</TableCell>
                  <TableCell className="text-sm text-gray-700">{row.language}</TableCell>
                  <TableCell className="text-sm text-gray-700">
                    <div className="flex flex-col gap-0.5">
                      <span>{row.maskedUser.email}</span>
                      <span>{row.maskedUser.phone}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-gray-700">{row.maskedIp}</TableCell>
                  <TableCell className="text-sm text-gray-700">{formatDateTime(row.timestamp)}</TableCell>
                  <TableCell className="text-sm text-gray-700">{row.sourceFlow}</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
