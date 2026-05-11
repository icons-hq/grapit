'use client';

import type { ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { PerformanceSeatMapInput } from '@grabit/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const DEFAULT_MAX_FLOORS = 7;

export interface FloorSeatMapEditorProps {
  value: PerformanceSeatMapInput[];
  onChange: (value: PerformanceSeatMapInput[]) => void;
  duplicateFloorError?: string | null;
  maxFloors?: number;
  renderPreview?: (context: {
    floor: PerformanceSeatMapInput;
    index: number;
    updateFloor: (nextFloor: PerformanceSeatMapInput) => void;
  }) => ReactNode;
}

export function createEmptySeatMapFloor(sortOrder: number): PerformanceSeatMapInput {
  const floorNumber = sortOrder + 1;

  return {
    floorKey: `${floorNumber}F`,
    floorLabel: `${floorNumber}층`,
    sortOrder,
    svgUrl: '',
    seatConfig: null,
    totalSeats: 0,
  };
}

export function findDuplicateFloorKeys(
  value: PerformanceSeatMapInput[],
): string[] {
  const counts = new Map<string, number>();

  for (const floor of value) {
    const normalizedKey = floor.floorKey.trim();

    if (!normalizedKey) {
      continue;
    }

    counts.set(normalizedKey, (counts.get(normalizedKey) ?? 0) + 1);
  }

  return value
    .map((floor) => floor.floorKey.trim())
    .filter((floorKey, index, keys) => {
      if (!floorKey) {
        return false;
      }

      return (counts.get(floorKey) ?? 0) > 1 && keys.indexOf(floorKey) === index;
    });
}

export function FloorSeatMapEditor({
  value,
  onChange,
  duplicateFloorError,
  maxFloors = DEFAULT_MAX_FLOORS,
  renderPreview,
}: FloorSeatMapEditorProps) {
  const duplicateKeys = findDuplicateFloorKeys(value);
  const duplicateKeySet = new Set(duplicateKeys);
  const duplicateMessage = duplicateKeys.length
    ? `중복된 floorKey가 있습니다: ${duplicateKeys.join(', ')}. 각 층 키를 고유하게 수정한 뒤 다시 저장해주세요.`
    : duplicateFloorError;

  function updateFloor(
    index: number,
    updater: (floor: PerformanceSeatMapInput) => PerformanceSeatMapInput,
  ) {
    onChange(value.map((floor, floorIndex) => (
      floorIndex === index ? updater(floor) : floor
    )));
  }

  function appendFloor() {
    onChange([...value, createEmptySeatMapFloor(value.length)]);
  }

  function removeFloor(index: number) {
    onChange(
      value
        .filter((_, floorIndex) => floorIndex !== index)
        .map((floor, floorIndex) => ({
          ...floor,
          sortOrder: floorIndex,
        })),
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-gray-900">다층 좌석맵 편집</p>
          <p className="text-sm text-gray-600">
            층별 `floorKey`, 라벨, 정렬 순서와 SVG 미리보기를 함께 관리합니다.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={appendFloor}
          disabled={value.length >= maxFloors}
        >
          <Plus className="h-4 w-4" />
          층 추가
        </Button>
      </div>

      {duplicateMessage && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {duplicateMessage}
        </div>
      )}

      {value.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-6 text-sm text-gray-600">
          아직 등록된 층이 없습니다. 공연장 구조에 맞춰 최대 7개 층까지 추가하세요.
        </div>
      ) : (
        value.map((floor, index) => {
          const isDuplicateFloorKey = duplicateKeySet.has(floor.floorKey.trim());

          return (
            <div key={`${floor.floorKey}-${index}`} className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-base font-semibold text-gray-900">
                      {floor.floorLabel || `층 ${index + 1}`}
                    </p>
                    <p className="text-sm text-gray-500">
                      sortOrder {floor.sortOrder}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeFloor(index)}
                    aria-label={`${floor.floorLabel || `층 ${index + 1}`} 삭제`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor={`seat-map-floor-key-${index}`}>floorKey</Label>
                    <Input
                      id={`seat-map-floor-key-${index}`}
                      value={floor.floorKey}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        updateFloor(index, (currentFloor) => ({
                          ...currentFloor,
                          floorKey: nextValue,
                        }));
                      }}
                      aria-invalid={isDuplicateFloorKey}
                    />
                    {isDuplicateFloorKey && (
                      <p className="text-sm text-red-600">
                        같은 floorKey가 이미 있습니다. 층 키를 고유하게 수정하세요.
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`seat-map-floor-label-${index}`}>층 라벨</Label>
                    <Input
                      id={`seat-map-floor-label-${index}`}
                      value={floor.floorLabel}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        updateFloor(index, (currentFloor) => ({
                          ...currentFloor,
                          floorLabel: nextValue,
                        }));
                      }}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`seat-map-floor-order-${index}`}>정렬 순서</Label>
                    <Input
                      id={`seat-map-floor-order-${index}`}
                      type="number"
                      value={floor.sortOrder}
                      onChange={(event) => {
                        const parsed = Number(event.target.value);
                        updateFloor(index, (currentFloor) => ({
                          ...currentFloor,
                          sortOrder: Number.isNaN(parsed) ? currentFloor.sortOrder : parsed,
                        }));
                      }}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`seat-map-floor-svg-url-${index}`}>SVG URL</Label>
                  <Input
                    id={`seat-map-floor-svg-url-${index}`}
                    value={floor.svgUrl}
                    readOnly
                    placeholder="SVG 업로드 후 자동으로 채워집니다"
                  />
                </div>

                {renderPreview?.({
                  floor,
                  index,
                  updateFloor: (nextFloor) => updateFloor(index, () => nextFloor),
                })}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
