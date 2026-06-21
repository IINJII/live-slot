import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { writeTmpFile } from '@/lib/fileManager';
import { getImageDimensions } from '@/lib/screenshotOverlay';
import { renderHtml5Creative } from '@/lib/renderHtml5';
import { CreativeType, UploadResult } from '@/types';

// Rasterizing an HTML5 creative launches a headless browser, so allow headroom.
export const maxDuration = 60;

const ALLOWED_TYPES: Record<string, { ext: string; type: CreativeType }> = {
  'image/jpeg': { ext: 'jpg', type: 'image' },
  'image/png': { ext: 'png', type: 'image' },
  'image/webp': { ext: 'webp', type: 'image' },
  'image/gif': { ext: 'gif', type: 'gif' },
  'video/mp4': { ext: 'mp4', type: 'video' },
  'video/webm': { ext: 'webm', type: 'video' },
  'application/zip': { ext: 'zip', type: 'html5' },
  'application/x-zip-compressed': { ext: 'zip', type: 'html5' },
  'text/html': { ext: 'html', type: 'html5' },
};

// Browsers sometimes send an empty/odd MIME for .zip/.html — fall back to the
// filename extension so HTML5 creatives still resolve.
function resolveByExtension(name: string): { ext: string; type: CreativeType } | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.zip')) return { ext: 'zip', type: 'html5' };
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return { ext: 'html', type: 'html5' };
  return null;
}

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
    const allowed = ALLOWED_TYPES[mimeType] ?? resolveByExtension(file.name);

    if (!allowed) {
      return NextResponse.json(
        { error: `Unsupported file type: ${mimeType || file.name}. Allowed: JPEG, PNG, WebP, GIF, MP4, WebM, ZIP, HTML` },
        { status: 400 }
      );
    }

    const fileId = uuidv4();
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let width = 0;
    let height = 0;
    // mimeType reported to the client; for HTML5 it becomes image/png after
    // rasterization so the preview/thumbnail renders the captured frame.
    let outMimeType = mimeType;

    if (allowed.type === 'html5') {
      // HTML5 creative (ZIP bundle or standalone .html): rasterize to a PNG
      // server-side, then store that PNG so it flows through the existing image
      // composite pipeline unchanged.
      try {
        const render = await renderHtml5Creative(
          buffer,
          allowed.ext === 'html' ? 'html' : 'zip',
        );
        writeTmpFile(fileId, 'png', render.pngBuffer);
        width = render.width;
        height = render.height;
        outMimeType = 'image/png';
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not process the HTML5 creative.';
        return NextResponse.json({ error: msg }, { status: 400 });
      }
    } else {
      writeTmpFile(fileId, allowed.ext, buffer);

      if (allowed.type === 'image' || allowed.type === 'gif') {
        try {
          const dims = await getImageDimensions(buffer);
          width = dims.width;
          height = dims.height;
        } catch {
          // Non-critical, continue
        }
      }
    }

    const result: UploadResult = {
      fileId,
      fileName: file.name,
      fileType: allowed.type,
      mimeType: outMimeType,
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
