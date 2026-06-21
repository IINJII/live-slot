import { NextRequest, NextResponse } from 'next/server';
import { getTmpFilePathById } from '@/lib/fileManager';
import { extractFrames } from '@/lib/extractFrames';

export async function POST(request: NextRequest) {
  try {
    const { fileId } = await request.json() as { fileId?: string };
    if (!fileId) return NextResponse.json({ error: 'fileId required' }, { status: 400 });

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(fileId)) return NextResponse.json({ error: 'Invalid fileId' }, { status: 400 });

    const inputPath = getTmpFilePathById(fileId);
    if (!inputPath) return NextResponse.json({ error: 'File not found' }, { status: 404 });

    const frames = await extractFrames(inputPath);
    return NextResponse.json({ frames });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Frame extraction error:', err);
    return NextResponse.json({ error: 'Failed to extract frames', detail: msg }, { status: 500 });
  }
}
