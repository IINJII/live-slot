import sharp from 'sharp';
import { AdSlot } from '@/types';

export async function compositeCreativeOnScreenshot({
  screenshotBase64,
  creativeBuffer,
  creativeMimeType,
  slot,
  pageWidth,
  pageHeight,
}: {
  screenshotBase64: string;
  creativeBuffer: Buffer;
  creativeMimeType: string;
  slot: AdSlot;
  pageWidth: number;
  pageHeight: number;
}): Promise<string> {
  const screenshotBuffer = Buffer.from(screenshotBase64, 'base64');

  // Get screenshot dimensions
  const screenshotMeta = await sharp(screenshotBuffer).metadata();
  const imgWidth = screenshotMeta.width ?? pageWidth;
  const imgHeight = screenshotMeta.height ?? pageHeight;

  // Scale factor between page coordinates and image pixels
  const scaleX = imgWidth / pageWidth;
  const scaleY = imgHeight / pageHeight;

  // Target position and size in image pixels
  const targetX = Math.round(slot.x * scaleX);
  const targetY = Math.round(slot.y * scaleY);
  const targetW = Math.round(slot.width * scaleX);
  const targetH = Math.round(slot.height * scaleY);

  // Clamp to image bounds
  const clampedX = Math.max(0, Math.min(targetX, imgWidth - 1));
  const clampedY = Math.max(0, Math.min(targetY, imgHeight - 1));
  const clampedW = Math.min(targetW, imgWidth - clampedX);
  const clampedH = Math.min(targetH, imgHeight - clampedY);

  if (clampedW <= 0 || clampedH <= 0) {
    return screenshotBase64;
  }

  let creativeResized: Buffer;

  if (creativeMimeType.startsWith('video/')) {
    // For video, create a placeholder with play icon
    creativeResized = await createVideoPlaceholder(clampedW, clampedH);
  } else if (creativeMimeType === 'application/zip' || creativeMimeType === 'application/x-zip-compressed') {
    // For HTML5 ZIP, create a placeholder
    creativeResized = await createHtml5Placeholder(clampedW, clampedH);
  } else {
    // Resize image to fit the slot
    creativeResized = await sharp(creativeBuffer)
      .resize(clampedW, clampedH, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .png()
      .toBuffer();
  }

  // Draw a highlight border around the slot on the screenshot first
  const highlightedScreenshot = await drawSlotHighlight(
    screenshotBuffer,
    clampedX,
    clampedY,
    clampedW,
    clampedH
  );

  // Composite creative onto screenshot
  const composited = await sharp(highlightedScreenshot)
    .composite([
      {
        input: creativeResized,
        left: clampedX,
        top: clampedY,
      },
    ])
    .png()
    .toBuffer();

  return composited.toString('base64');
}

async function drawSlotHighlight(
  screenshotBuffer: Buffer,
  x: number,
  y: number,
  w: number,
  h: number
): Promise<Buffer> {
  const borderSvg = `
    <svg width="${w + 8}" height="${h + 8}" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="${w + 4}" height="${h + 4}" 
        fill="none" stroke="#6366f1" stroke-width="4" stroke-dasharray="8,4" rx="2"/>
    </svg>
  `;

  return sharp(screenshotBuffer)
    .composite([
      {
        input: Buffer.from(borderSvg),
        left: Math.max(0, x - 4),
        top: Math.max(0, y - 4),
      },
    ])
    .png()
    .toBuffer();
}

async function createVideoPlaceholder(width: number, height: number): Promise<Buffer> {
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="#1e1b4b" opacity="0.9"/>
      <circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) * 0.15}" 
        fill="#6366f1"/>
      <polygon points="${width / 2 - Math.min(width, height) * 0.06},${height / 2 - Math.min(width, height) * 0.1} 
                       ${width / 2 + Math.min(width, height) * 0.1},${height / 2} 
                       ${width / 2 - Math.min(width, height) * 0.06},${height / 2 + Math.min(width, height) * 0.1}" 
        fill="white"/>
      <text x="${width / 2}" y="${height / 2 + Math.min(width, height) * 0.25}" 
        text-anchor="middle" fill="#a5b4fc" font-family="sans-serif" font-size="${Math.max(10, Math.min(width, height) * 0.08)}">
        Video Ad
      </text>
    </svg>
  `;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function createHtml5Placeholder(width: number, height: number): Promise<Buffer> {
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="#0f172a" opacity="0.9"/>
      <text x="${width / 2}" y="${height / 2 - 10}" 
        text-anchor="middle" fill="#6366f1" font-family="sans-serif" 
        font-size="${Math.max(12, Math.min(width, height) * 0.1)}" font-weight="bold">
        HTML5
      </text>
      <text x="${width / 2}" y="${height / 2 + 20}" 
        text-anchor="middle" fill="#94a3b8" font-family="sans-serif" 
        font-size="${Math.max(9, Math.min(width, height) * 0.07)}">
        Rich Media Ad
      </text>
    </svg>
  `;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function getImageDimensions(buffer: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(buffer).metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0 };
}
