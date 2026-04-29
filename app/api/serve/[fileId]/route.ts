import { NextRequest, NextResponse } from 'next/server';
import { readTmpFile, getExtFromFileId } from '@/lib/fileManager';

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const { fileId } = await params;

  // Validate fileId is a UUID
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(fileId)) {
    return NextResponse.json({ error: 'Invalid fileId' }, { status: 400 });
  }

  const buffer = readTmpFile(fileId);
  if (!buffer) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  const ext = getExtFromFileId(fileId);
  const mimeType = ext ? (EXT_TO_MIME[ext] ?? 'application/octet-stream') : 'application/octet-stream';

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': mimeType,
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
