'use client';

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

interface FloorOption {
  floorKey: string;
  floorLabel: string;
  selectedCount: number;
  isSoldOut: boolean;
  totalSeats?: number;
}

interface FloorSelectorProps {
  floors: FloorOption[];
  selectedFloorKey: string | null;
  onChange: (floorKey: string) => void;
}

export function FloorSelector({
  floors,
  selectedFloorKey,
  onChange,
}: FloorSelectorProps) {
  if (floors.length === 0) {
    return null;
  }

  return (
    <div className="sticky top-12 z-30 -mx-4 border-y border-border bg-white/95 px-4 py-3 backdrop-blur lg:top-14 lg:-mx-0 lg:rounded-xl lg:border lg:px-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-gray-900">층 선택</p>
        <p className="text-xs text-gray-500">선택한 좌석은 층을 바꿔도 유지됩니다</p>
      </div>
      <div className="mt-3 overflow-x-auto pb-1">
        <ToggleGroup
          type="single"
          value={selectedFloorKey ?? undefined}
          onValueChange={(value) => {
            if (value) {
              onChange(value);
            }
          }}
          variant="outline"
          spacing={1}
          className="grid min-w-max grid-flow-col auto-cols-[minmax(160px,1fr)] gap-2 lg:flex lg:w-full"
          aria-label="층 선택"
        >
          {floors.map((floor) => (
            <ToggleGroupItem
              key={floor.floorKey}
              value={floor.floorKey}
              className="h-auto min-h-12 flex-1 justify-center gap-2 rounded-lg border-2 border-border bg-white px-4 py-2 text-gray-700 transition-colors hover:bg-gray-50 data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-white"
              aria-label={floor.floorLabel}
            >
              <span>
                {floor.floorLabel}
                {typeof floor.totalSeats === 'number' ? (
                  <span className="ml-1 text-xs opacity-80">
                    ({floor.totalSeats.toLocaleString()}석)
                  </span>
                ) : null}
              </span>
              {floor.selectedCount > 0 ? (
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold data-[state=off]:bg-primary/10 data-[state=off]:text-primary">
                  {floor.selectedCount}
                </span>
              ) : floor.isSoldOut ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                  혼잡
                </span>
              ) : null}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    </div>
  );
}
