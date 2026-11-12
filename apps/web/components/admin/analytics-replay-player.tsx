'use client';
import { useEffect, useRef, useState } from 'react';
import { Replayer } from '@rrweb/replay';
import '@rrweb/replay/dist/style.css';
import type { ReplayEvent } from '@grabit/shared';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api-client';

export default function AnalyticsReplayPlayer({ recordingId }: { recordingId: string }) {
  const container = useRef<HTMLDivElement>(null); const player = useRef<Replayer | null>(null);
  const [status, setStatus] = useState('화면 기록 불러오는 중…'); const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0); const [playing, setPlaying] = useState(false);
  useEffect(() => {
    let disposed = false; let instance: Replayer | undefined; let observer: ResizeObserver | undefined;
    void apiClient.get<{ events: ReplayEvent[] }>(`/api/v1/admin/analytics/replays/${recordingId}`, { showErrorToast: false }).then(({ events }) => {
      if (disposed || !container.current) return;
      instance = new Replayer(events as ConstructorParameters<typeof Replayer>[0], { root: container.current, showWarning: false, showDebug: false, skipInactive: true, mouseTail: true, blockClass: 'rr-block' });
      player.current = instance; setDuration(instance.getMetaData().totalTime); setStatus(''); instance.pause(0);
      const fit = () => {
        const wrapper = container.current?.querySelector<HTMLElement>('.replayer-wrapper');
        const frame = container.current?.querySelector<HTMLIFrameElement>('iframe');
        if (!wrapper || !frame || !container.current) return;
        const width = Number(frame.getAttribute('width')) || frame.offsetWidth || 1280;
        const height = Number(frame.getAttribute('height')) || frame.offsetHeight || 720;
        const scale = Math.min(1, container.current.clientWidth / width);
        wrapper.style.transform = `scale(${scale})`; wrapper.style.transformOrigin = 'top left';
        container.current.style.height = `${Math.min(850, height * scale)}px`;
      };
      observer = new ResizeObserver(fit); observer.observe(container.current); instance.on('resize', fit); fit();
    }).catch(() => { if (!disposed) setStatus('재생 가능한 기록이 없거나 불러오지 못했습니다.'); });
    const tick = window.setInterval(() => { if (player.current) setPosition(player.current.getCurrentTime()); }, 250);
    return () => { disposed = true; clearInterval(tick); observer?.disconnect(); instance?.destroy(); player.current = null; };
  }, [recordingId]);
  return <section className="min-w-0 space-y-3" aria-label="세션 리플레이">
    <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" disabled={!!status} onClick={() => { if (playing) player.current?.pause(); else player.current?.play(position >= duration ? 0 : position); setPlaying(!playing); }}>{playing ? '일시 정지' : '재생'}</Button>
      <Button size="sm" variant="outline" disabled={!!status} onClick={() => { player.current?.pause(0); setPosition(0); setPlaying(false); }}>처음으로</Button>
      <span className="text-xs tabular-nums">{Math.floor(position / 1000)} / {Math.ceil(duration / 1000)}초</span>
      <label className="text-xs">속도 <select className="rounded border bg-background p-1" defaultValue="1" onChange={(e) => player.current?.setConfig({ speed: Number(e.target.value) })}><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></label>
    </div>
    <input aria-label="재생 위치" className="w-full" type="range" min={0} max={Math.max(1, duration)} value={Math.min(position, duration)} disabled={!!status} onChange={(e) => { const time = Number(e.target.value); player.current?.pause(time); setPosition(time); setPlaying(false); }} />
    {status && <p role="status" className="text-sm text-muted-foreground">{status}</p>}
    <div ref={container} className="relative min-h-32 w-full overflow-auto rounded border bg-white" />
    <p className="text-xs text-muted-foreground">동의 이후의 페이지 구조·마우스·터치·스크롤 재생입니다. 모든 텍스트와 입력값은 마스킹하며 이미지·영상·외부 결제창은 제외됩니다. 누락된 구간은 복원하지 않습니다.</p>
  </section>;
}
