import { NextResponse } from 'next/server';
import { readRuntimeFlagsFromEnv } from '@/lib/runtime-flags';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(readRuntimeFlagsFromEnv(process.env));
}
