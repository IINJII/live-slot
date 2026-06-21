import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { writeTmpFile } from '@/lib/fileManager';

interface MediaFileInfo {
  url: string;
  type: string;
  width: number;
  height: number;
  bitrate: number;
}

function parseMediaFiles(xml: string): MediaFileInfo[] {
  const files: MediaFileInfo[] = [];
  const regex = /<MediaFile([^>]*)>([\s\S]*?)<\/MediaFile>/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(xml)) !== null) {
    const attrs = m[1];
    const raw = m[2].replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    if (!raw.startsWith('http')) continue;
    const get = (name: string) => {
      const hit = attrs.match(new RegExp(`${name}="([^"]*)"`, 'i'));
      return hit ? hit[1] : '';
    };
    files.push({
      url: raw,
      type: get('type') || 'video/mp4',
      width: parseInt(get('width') || '0', 10),
      height: parseInt(get('height') || '0', 10),
      bitrate: parseInt(get('bitrate') || '0', 10),
    });
  }
  return files;
}

function pickBest(files: MediaFileInfo[]): MediaFileInfo | null {
  if (!files.length) return null;
  const mp4 = files.filter(f => f.type.includes('mp4') || f.url.split('?')[0].endsWith('.mp4'));
  const pool = mp4.length ? mp4 : files;
  return pool.sort((a, b) => (b.bitrate || b.width * b.height) - (a.bitrate || a.width * a.height))[0];
}

async function resolveVast(input: string, isXml: boolean, depth = 0): Promise<MediaFileInfo[]> {
  if (depth > 4) throw new Error('Too many VAST redirects');
  const xml = isXml ? input : await (await fetch(input, {
    headers: { 'User-Agent': 'LiveSlot/1.0 VAST-Inspector' },
  })).text();

  const mediaFiles = parseMediaFiles(xml);
  if (mediaFiles.length) return mediaFiles;

  // Follow VAST wrapper
  const wrapperMatch = xml.match(/<VASTAdTagURI[^>]*>\s*(?:<!\[CDATA\[)?\s*(https?:\/\/[^\s\]<"]+)/i);
  if (wrapperMatch) return resolveVast(wrapperMatch[1].trim(), false, depth + 1);

  throw new Error('No video found in VAST response');
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { url?: string; vastXml?: string };
    const { url, vastXml } = body;

    if (!url && !vastXml) {
      return NextResponse.json({ error: 'Provide either url or vastXml' }, { status: 400 });
    }

    let mediaFiles: MediaFileInfo[];
    try {
      mediaFiles = vastXml
        ? await resolveVast(vastXml, true)
        : await resolveVast(url!, false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to parse VAST';
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const best = pickBest(mediaFiles);
    if (!best) {
      return NextResponse.json({ error: 'No suitable video found in VAST' }, { status: 400 });
    }

    const videoRes = await fetch(best.url, {
      headers: { 'User-Agent': 'LiveSlot/1.0' },
    });
    if (!videoRes.ok) {
      return NextResponse.json(
        { error: `Failed to download video (HTTP ${videoRes.status})` },
        { status: 502 }
      );
    }

    const buffer = Buffer.from(await videoRes.arrayBuffer());
    const fileId = uuidv4();
    const ext = best.type.includes('webm') || best.url.split('?')[0].endsWith('.webm') ? 'webm' : 'mp4';
    writeTmpFile(fileId, ext, buffer);

    const rawName = best.url.split('/').pop()?.split('?')[0] || `vast-video.${ext}`;

    return NextResponse.json({
      fileId,
      videoUrl: `/api/serve/${fileId}`,
      fileName: rawName,
      size: buffer.byteLength,
      width: best.width,
      height: best.height,
    });
  } catch (err) {
    console.error('VAST parse error:', err);
    return NextResponse.json({ error: 'Failed to process VAST' }, { status: 500 });
  }
}
