'use client';

import { Pie, PieChart, Cell } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from '@/components/ui/chart';
import type { DashboardGenreDto } from '@grabit/shared';

const PALETTE = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

interface Props {
  data: DashboardGenreDto;
}

export function GenreDonutChart({ data }: Props) {
  const chartConfig: ChartConfig = Object.fromEntries(
    data.map((d, i) => [
      d.genre,
      { label: d.genre, color: PALETTE[i % PALETTE.length] },
    ]),
  );
  const total = data.reduce((acc, d) => acc + d.count, 0);
  return (
    <>
      <span className="sr-only">
        {`분류별 예매 분포: ${data.length}개 분류, 총 ${total.toLocaleString()}건`}
      </span>
      <ChartContainer
        config={chartConfig}
        className="h-[280px] w-full motion-reduce:[&_*]:!transition-none"
      >
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent nameKey="genre" />} />
          <Pie
            data={data}
            dataKey="count"
            nameKey="genre"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={2}
            isAnimationActive={false}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
          <ChartLegend content={<ChartLegendContent nameKey="genre" />} />
        </PieChart>
      </ChartContainer>
    </>
  );
}
