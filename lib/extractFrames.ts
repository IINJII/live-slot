import { execFile } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { tmpdir } from 'os';
import { readFile, readdir, rm, mkdir } from 'fs/promises';
import ffmpegPath from 'ffmpeg-static';
import { v4 as uuidv4 } from 'uuid';
import { writeTmpFile } from './fileManager';

const execP = promisify(execFile);
const EXEC_OPTS = { maxBuffer: 50 * 1024 * 1024 };

const FRAME_INTERVAL = 5;

export interface ExtractedFrame {
  frameId: string;
  timestamp: number;
  url: string;
}


async function getVideoDuration(bin: string, inputPath: string): Promise<number> {
  // ffmpeg -i with no output always exits non-zero; the duration is in its stderr
  const err = await execP(bin, ['-i', inputPath], EXEC_OPTS).catch(e => e as { stderr?: string });
  const match = ((err as { stderr?: string }).stderr ?? '').match(
    /Duration:\s*(\d+):(\d+):(\d+\.?\d*)/
  );
  if (!match) return 30;
  return parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3]);
}

export async function extractFrames(inputPath: string): Promise<ExtractedFrame[]> {
  const bin = ffmpegPath;
  if (!bin) throw new Error('ffmpeg binary not found');

  const workDir = join(tmpdir(), `ls-frames-${uuidv4()}`);
  const framesDir = join(workDir, 'frames');

  await mkdir(framesDir, { recursive: true });

  try {
    const duration = await getVideoDuration(bin, inputPath);

    // Timestamps at exactly 0, 5, 10 … seconds
    const timestamps: number[] = [];
    for (let t = 0; t < duration; t += FRAME_INTERVAL) timestamps.push(t);
    if (timestamps.length === 0) timestamps.push(0);

    // Per-timestamp extraction: -ss BEFORE -i = fast input seek to nearest keyframe.
    // This guarantees t=0 always yields the very first frame of the video.
    for (let i = 0; i < timestamps.length; i++) {
      const outPath = join(framesDir, `frame_${String(i + 1).padStart(4, '0')}.jpg`);
      await execP(bin, [
        '-loglevel', 'error',
        '-ss', String(timestamps[i]),
        '-i', inputPath,
        '-frames:v', '1',
        '-q:v', '2',
        outPath,
      ], EXEC_OPTS).catch(() => {/* timestamp past end of file — skip */});
    }

    // Read extracted frame files in timestamp order
    const frameFiles = (await readdir(framesDir)).filter(f => f.endsWith('.jpg')).sort();

    const results: ExtractedFrame[] = [];
    for (let i = 0; i < frameFiles.length; i++) {
      const buf = await readFile(join(framesDir, frameFiles[i]));
      const frameId = uuidv4();
      writeTmpFile(frameId, 'jpg', buf);
      results.push({ frameId, timestamp: timestamps[i] ?? i * FRAME_INTERVAL, url: `/api/serve/${frameId}` });
    }

    return results;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
