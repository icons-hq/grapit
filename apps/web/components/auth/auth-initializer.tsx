'use client';

import { useEffect } from 'react';
import { initializeAuth } from '@/lib/auth';

/** Restore the session without taking public browsing or help away from a buyer. */
export function AuthInitializer() {
  useEffect(() => { void initializeAuth(); }, []);
  return null;
}
