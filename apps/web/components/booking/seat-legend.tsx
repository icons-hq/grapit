'use client';

interface SeatLegendProps {
  tiers: Array<{ name: string; color: string; price: number }>;
  showExcluded?: boolean;
}

export function SeatLegend({ tiers, showExcluded = false }: SeatLegendProps) {
  if (tiers.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-500">등급별 좌석 안내</p>
      <div className="flex items-center gap-4 overflow-x-auto rounded-lg bg-gray-50 px-6 py-3">
        {tiers.map((tier) => (
          <div key={tier.name} className="flex shrink-0 items-center gap-2">
            <span
              className="inline-block size-3 rounded-full"
              style={{ backgroundColor: tier.color }}
            />
            <span className="text-sm text-gray-700">{tier.name}</span>
            <span className="text-sm text-gray-500">
              {tier.price.toLocaleString()}원
            </span>
          </div>
        ))}
        {showExcluded ? (
          <div className="flex shrink-0 items-center gap-2">
            <span
              className="inline-block size-3 rounded-sm border border-black/10"
              style={{ backgroundColor: '#F4D03F' }}
            />
            <span className="text-sm text-gray-700">사석 / 초대석</span>
            <span className="text-sm text-gray-500">선택 제외</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
