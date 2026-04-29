import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { writeTmpFile } from '@/lib/fileManager';
import { getImageDimensions } from '@/lib/screenshotOverlay';
import { CreativeType, UploadResult } from '@/types';

const ALLOWED_TYPES: Record<string, { ext: string; type: CreativeType }> = {
  'image/jpeg': { ext: 'jpg', type: 'image' },
  'image/png': { ext: 'png', type: 'image' },
  'image/webp': { ext: 'webp', type: 'image' },
  'image/gif': { ext: 'gif', type: 'gif' },
  'video/mp4': { ext: 'mp4', type: 'video' },
  'video/webm': { ext: 'webm', type: 'video' },
  'application/zip': { ext: 'zip', type: 'html5' },
  'application/x-zip-compressed': { ext: 'zip', type: 'html5' },
};

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File too large. Maximum size is 50MB.' }, { status: 400 });
    }

    const mimeType = file.type;
    const allowed = ALLOWED_TYPES[mimeType];

    if (!allowed) {
      return NextResponse.json(
        { error: `Unsupported file type: ${mimeType}. Allowed: JPEG, PNG, WebP, GIF, MP4, WebM, ZIP` },
        { status: 400 }
      );
    }

    const fileId = uuidv4();
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    writeTmpFile(fileId, allowed.ext, buffer);

    // Get dimensions for images
    let width = 0;
    let height = 0;

    if (allowed.type === 'image' || allowed.type === 'gif') {
      try {
        const dims = await getImageDimensions(buffer);
        width = dims.width;
        height = dims.height;
      } catch {
        // Non-critical, continue
      }
    }

    const result: UploadResult = {
      fileId,
      fileName: file.name,
      fileType: allowed.type,
      mimeType,
      width,
      height,
      tempUrl: `/api/serve/${fileId}`,
      size: file.size,
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error('Upload error:', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
