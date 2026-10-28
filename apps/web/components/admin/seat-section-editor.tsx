'use client';

import type { SeatMapConfig } from '@grabit/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type Section = NonNullable<SeatMapConfig['sections']>[number];

export function SeatSectionEditor({ config, onChange, floorKey }: {
  config: SeatMapConfig | null;
  onChange: (config: SeatMapConfig) => void;
  floorKey: string;
}) {
  if (!config) return null;
  const sections = config.sections ?? [];
  const available = new Set(config.tiers.flatMap((tier) => tier.seatIds));
  function update(index: number, next: Section) {
    onChange({ ...config!, sections: sections.map((section, position) => position === index ? next : section) });
  }
  return <div className="space-y-3 rounded-lg border bg-white p-4">
    <div className="flex items-center justify-between gap-3"><div>
      <h4 className="text-sm font-semibold">구역 선택 설정</h4>
      <p className="mt-1 text-xs text-gray-500">구역을 지정하면 구매자가 구역별 잔여 좌석을 확인하고 좌석도를 확대할 수 있습니다.</p>
    </div><Button type="button" size="sm" variant="outline" onClick={() => {
      let number = sections.length + 1;
      while (sections.some((section) => section.sectionKey === `S${number}`)) number++;
      onChange({ ...config, sections: [...sections, { sectionKey: `S${number}`, label: `구역 ${number}`, seatIds: [] }] });
    }}>구역 추가</Button></div>
    {!sections.length ? <p className="text-sm text-gray-500">현재는 층 전체 좌석도를 사용합니다.</p> : null}
    {sections.map((section, index) => <div key={index} className="grid gap-3 rounded-lg bg-gray-50 p-3 sm:grid-cols-[1fr_1fr_auto]">
      <div><Label htmlFor={`${floorKey}-section-key-${index}`}>구역 키</Label>
        <Input id={`${floorKey}-section-key-${index}`} value={section.sectionKey}
          onChange={(event) => update(index, { ...section, sectionKey: event.target.value })} /></div>
      <div><Label htmlFor={`${floorKey}-section-label-${index}`}>표시 이름</Label>
        <Input id={`${floorKey}-section-label-${index}`} value={section.label}
          onChange={(event) => update(index, { ...section, label: event.target.value })} /></div>
      <Button className="self-end" type="button" variant="ghost" onClick={() =>
        onChange({ ...config, sections: sections.filter((_, position) => position !== index) })}>구역 삭제</Button>
      <div className="sm:col-span-3"><Label htmlFor={`${floorKey}-section-seats-${index}`}>좌석 ID · 쉼표 또는 줄바꿈으로 구분</Label>
        <Textarea key={section.seatIds.join('|')} id={`${floorKey}-section-seats-${index}`} defaultValue={section.seatIds.join(', ')}
          placeholder="A-1, A-2, A-3" rows={2} onBlur={(event) => update(index, { ...section,
            seatIds: event.target.value.split(/[,\n]/).map((value) => value.trim()).filter(Boolean),
          })} />
        <p className="mt-1 text-xs text-gray-500">{section.seatIds.length}석 배정</p>
        {section.seatIds.some((id) => !available.has(id)) ? <p role="alert" className="text-xs text-red-600">좌석 등급에 등록되지 않은 ID가 있습니다.</p> : null}
      </div>
    </div>)}
  </div>;
}
