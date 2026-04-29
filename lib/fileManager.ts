import fs from 'fs';
import path from 'path';
import os from 'os';

// Use /tmp on Vercel, OS temp dir locally
const TMP_DIR = process.env.VERCEL ? '/tmp' : os.tmpdir();

export function getTmpDir(): string {
  return TMP_DIR;
}

export function getTmpFilePath(fileId: string, ext: string): string {
  return path.join(TMP_DIR, `${fileId}.${ext}`);
}

export function getTmpFilePathById(fileId: string): string | null {
  try {
    const files = fs.readdirSync(TMP_DIR);
    const match = files.find((f) => f.startsWith(fileId));
    return match ? path.join(TMP_DIR, match) : null;
  } catch {
    return null;
  }
}

export function getExtFromFileId(fileId: string): string | null {
  try {
    const files = fs.readdirSync(TMP_DIR);
    const match = files.find((f) => f.startsWith(fileId));
    if (!match) return null;
    return path.extname(match).replace('.', '');
  } catch {
    return null;
  }
}

export function writeTmpFile(fileId: string, ext: string, buffer: Buffer): string {
  const filePath = getTmpFilePath(fileId, ext);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

export function readTmpFile(fileId: string): Buffer | null {
  const filePath = getTmpFilePathById(fileId);
  if (!filePath || !fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath);
}

export function deleteTmpFile(fileId: string): boolean {
  const filePath = getTmpFilePathById(fileId);
  if (!filePath || !fs.existsSync(filePath)) return false;
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

export function tmpFileExists(fileId: string): boolean {
  const filePath = getTmpFilePathById(fileId);
  return !!filePath && fs.existsSync(filePath);
}
