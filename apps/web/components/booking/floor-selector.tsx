'use client';

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

interface FloorOption {
  floorKey: string;
  floorLabel: string;
  selectedCount: number;
  isSoldOut: boolean;
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
    <div className="sticky top-12 z-30 -mx-4 border-y border-border bg-white/95 px-4 py-3 backdrop-blur lg:top-14 lg:-mx-0 lg:border lg:rounded-xl lg:px-4">
      <p className="text-sm font-semibold text-gray-900">층 선택</p>
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
          className="min-w-max"
          aria-label="층 선택"
        >
          {floors.map((floor) => (
            <ToggleGroupItem
              key={floor.floorKey}
              value={floor.floorKey}
              className="min-h-11 gap-2 rounded-full px-4 data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
              aria-label={floor.floorLabel}
            >
              <span>{floor.floorLabel}</span>
              {floor.selectedCount > 0 ? (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
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
