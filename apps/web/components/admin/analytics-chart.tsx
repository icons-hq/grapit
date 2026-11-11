'use client';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import type { AnalyticsReport } from '@grabit/shared';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
export default function AnalyticsChart({ data }: { data: AnalyticsReport['trend'] }) {
  return <ChartContainer config={{ visitors: { label: '방문자', color: 'var(--chart-1)' }, pageViews: { label: '페이지뷰', color: 'var(--chart-2)' } }} className="h-[260px] w-full">
    <AreaChart data={data} accessibilityLayer margin={{ left: -20, right: 8 }}><CartesianGrid vertical={false} strokeDasharray="3 3" />
      <XAxis dataKey="hour" tickFormatter={(v: string) => v.slice(5, 13)} minTickGap={40} tickLine={false} axisLine={false} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} />
      <ChartTooltip content={<ChartTooltipContent />} /><Area dataKey="pageViews" stroke="var(--chart-2)" fill="var(--chart-2)" fillOpacity={0.08} isAnimationActive={false} /><Area dataKey="visitors" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.14} isAnimationActive={false} />
    </AreaChart>
  </ChartContainer>;
}
