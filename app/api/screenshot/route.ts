import { NextRequest, NextResponse } from 'next/server';
import { compositeCreativeOnScreenshot } from '@/lib/screenshotOverlay';
import { AdSlot } from '@/types';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { creativeBase64, creativeMimeType, slot, screenshotBase64, pageWidth, pageHeight } = body as {
      creativeBase64: string;
      creativeMimeType: string;
      slot: AdSlot;
      screenshotBase64: string;
      pageWidth: number;
      pageHeight: number;
    };

    if (!creativeBase64 || !creativeMimeType || !slot || !screenshotBase64) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const creativeBuffer = Buffer.from(creativeBase64, 'base64');

    const compositeBase64 = await compositeCreativeOnScreenshot({
      screenshotBase64,
      creativeBuffer,
      creativeMimeType,
      slot,
      pageWidth,
      pageHeight,
    });

    return NextResponse.json({
      slotId: slot.id,
      compositeImageBase64: compositeBase64,
    });
  } catch (err) {
    console.error('Screenshot composite error:', err);
    const message = err instanceof Error ? err.message : 'Screenshot generation failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
