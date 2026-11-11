'use client';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import type { SignupMonitoringResponse } from '@grabit/shared';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';

export default function SignupMonitoringChart({ data }: { data: SignupMonitoringResponse['hourly'] }) {
  return <ChartContainer config={{ signups: { label: '신규 가입', color: 'var(--chart-1)' } }} className="h-[230px] w-full">
    <AreaChart data={data} accessibilityLayer margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
      <CartesianGrid vertical={false} strokeDasharray="3 3" />
      <XAxis dataKey="hour" tickFormatter={(value: string) => data.length > 24 ? value.slice(5, 13) + '시' : value.slice(11)} minTickGap={36} tickLine={false} axisLine={false} />
      <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
      <ChartTooltip content={<ChartTooltipContent nameKey="signups" />} />
      <Area dataKey="signups" type="step" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.12} isAnimationActive={false} />
    </AreaChart>
  </ChartContainer>;
}
