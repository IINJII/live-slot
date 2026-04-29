import { NextRequest, NextResponse } from 'next/server';
import { compositeCreativeOnScreenshot } from '@/lib/screenshotOverlay';
import { readTmpFile, getExtFromFileId } from '@/lib/fileManager';
import { AdSlot } from '@/types';

export const maxDuration = 60;

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  zip: 'application/zip',
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { fileId, slot, screenshotBase64, pageWidth, pageHeight } = body as {
      fileId: string;
      slot: AdSlot;
      screenshotBase64: string;
      pageWidth: number;
      pageHeight: number;
    };

    if (!fileId || !slot || !screenshotBase64) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const creativeBuffer = readTmpFile(fileId);
    if (!creativeBuffer) {
      return NextResponse.json({ error: 'Creative file not found. Please re-upload.' }, { status: 404 });
    }

    const ext = getExtFromFileId(fileId);
    const mimeType = ext ? (EXT_TO_MIME[ext] ?? 'application/octet-stream') : 'application/octet-stream';

    const compositeBase64 = await compositeCreativeOnScreenshot({
      screenshotBase64,
      creativeBuffer,
      creativeMimeType: mimeType,
      slot,
      pageWidth,
      pageHeight,
    });

    return NextResponse.json({
      slotId: slot.id,
      compositeImageBase64: compositeBase64,
      creativeFileId: fileId,
    });
  } catch (err) {
    console.error('Screenshot composite error:', err);
    const message = err instanceof Error ? err.message : 'Screenshot generation failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
