'use client';

import { FormEvent, useState } from 'react';
import { Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { CreateTranslationSourceInput, TranslationSource } from '@/hooks/use-admin';

interface TranslationSourceFormProps {
  onCreateSource: (
    input: CreateTranslationSourceInput,
  ) => Promise<TranslationSource | { id: string }>;
  onGenerateDrafts: (sourceId: string) => Promise<unknown>;
  isCreating: boolean;
  isGenerating: boolean;
}

export function TranslationSourceForm({
  onCreateSource,
  onGenerateDrafts,
  isCreating,
  isGenerating,
}: TranslationSourceFormProps) {
  const [entityType, setEntityType] = useState('performance');
  const [entityId, setEntityId] = useState('');
  const [field, setField] = useState('description');
  const [sourceTitle, setSourceTitle] = useState('');
  const [sourceBody, setSourceBody] = useState('');
  const [sourceId, setSourceId] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const sourceText = `${sourceTitle.trim()}\n\n${sourceBody.trim()}`.trim();
    const source = await onCreateSource({
      entityType,
      entityId: entityId.trim(),
      field,
      sourceText,
    });
    setSourceId(source.id);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-lg bg-white p-4 shadow-sm"
    >
      <div className="flex items-center gap-2">
        <Languages className="h-5 w-5 text-primary" />
        <h2 className="text-heading font-semibold leading-[1.2]">
          한국어 원문 등록
        </h2>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="translation-entity-type">콘텐츠 유형</Label>
          <select
            id="translation-entity-type"
            value={entityType}
            onChange={(event) => setEntityType(event.target.value)}
            className="flex h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="performance">performance</option>
            <option value="banner">banner</option>
            <option value="notice">notice</option>
            <option value="legal">legal</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="translation-entity-id">콘텐츠 ID</Label>
          <Input
            id="translation-entity-id"
            value={entityId}
            onChange={(event) => setEntityId(event.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="translation-field">필드</Label>
          <select
            id="translation-field"
            value={field}
            onChange={(event) => setField(event.target.value)}
            className="flex h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="title">title</option>
            <option value="description">description</option>
            <option value="salesInfo">salesInfo</option>
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="translation-source-title">원문 제목</Label>
        <Input
          id="translation-source-title"
          value={sourceTitle}
          onChange={(event) => setSourceTitle(event.target.value)}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="translation-source-body">한국어 원문</Label>
        <Textarea
          id="translation-source-body"
          value={sourceBody}
          onChange={(event) => setSourceBody(event.target.value)}
          rows={5}
          required
        />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" disabled={isCreating}>
          원문 저장
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!sourceId || isGenerating}
          onClick={() => {
            if (sourceId) void onGenerateDrafts(sourceId);
          }}
        >
          en/th/zh-CN/zh-TW 초안 생성
        </Button>
      </div>
    </form>
  );
}
