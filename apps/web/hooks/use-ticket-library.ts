'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/use-auth-store';
import { apiClient } from '@/lib/api-client';

export function useFavorites(enabled = true) {
  const userId = useAuthStore((s) => s.user?.id);
  const authenticated = useAuthStore((s) => s.isInitialized && !!s.accessToken && !!s.user);
  const query = useQuery({
    queryKey: ['ticket-favorites', userId],
    queryFn: () => apiClient.get<{ ids: string[] }>('/api/v1/users/me/favorites'),
    enabled: enabled && authenticated,
  });
  return { ...query, authenticated, userId };
}
export function useToggleFavorite() {
  const userId = useAuthStore((s) => s.user?.id);
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, saved }: { id: string; saved: boolean }) => saved
      ? apiClient.delete<{saved:boolean}>(`/api/v1/users/me/favorites/${id}`)
      : apiClient.put<{saved:boolean}>(`/api/v1/users/me/favorites/${id}`),
    onSuccess: (_data, { id, saved }) => {
      client.setQueryData<{ids:string[]}>(['ticket-favorites', userId], (old) => ({
        ids: saved ? (old?.ids ?? []).filter((item) => item !== id) : [id, ...(old?.ids ?? []).filter((item) => item !== id)],
      }));
    },
  });
}

const RECENT_KEY = 'grabit:recent-performances:v1';
const RECENT_EVENT = 'grabit:recent-performances';
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
type RecentEntry = { id: string; viewedAt: number };

export function readRecentPerformances(now = Date.now()): RecentEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    const ids = new Set<string>();
    return value.filter((entry): entry is RecentEntry => {
      if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string'
        || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(entry.id) || typeof entry.viewedAt !== 'number'
        || !Number.isFinite(entry.viewedAt) || entry.viewedAt > now || now - entry.viewedAt >= RETENTION_MS || ids.has(entry.id)) return false;
      ids.add(entry.id); return true;
    }).slice(0, 24);
  } catch { return []; }
}
export function rememberPerformance(id: string) {
  if (typeof window === 'undefined') return;
  try {
    const now = Date.now();
    const entries = [{id,viewedAt:now}, ...readRecentPerformances(now).filter((entry) => entry.id !== id)].slice(0,24);
    localStorage.setItem(RECENT_KEY,JSON.stringify(entries));
    window.dispatchEvent(new Event(RECENT_EVENT));
  } catch { /* Viewing a performance also works when browser storage is unavailable. */ }
}
export function clearRecentPerformances() {
  try { localStorage.removeItem(RECENT_KEY); window.dispatchEvent(new Event(RECENT_EVENT)); } catch { /* No stored history. */ }
}
export function useRecentPerformanceIds() {
  const [ids,setIds] = useState<string[]>([]);
  const [ready,setReady] = useState(false);
  useEffect(() => {
    function sync() { setIds(readRecentPerformances().map((entry) => entry.id)); setReady(true); }
    sync(); window.addEventListener(RECENT_EVENT,sync); window.addEventListener('storage',sync);
    return () => { window.removeEventListener(RECENT_EVENT,sync); window.removeEventListener('storage',sync); };
  },[]);
  return { ids, ready };
}
