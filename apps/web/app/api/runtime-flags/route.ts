import { NextResponse } from 'next/server';
import { buildRuntimeFlagsPayload } from '@/lib/runtime-flags';

export const dynamic = 'force-dynamic';

export function GET() {
  // serverNow feeds the browser clock offset, so no cache may replay it.
  return NextResponse.json(buildRuntimeFlagsPayload(process.env), {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
