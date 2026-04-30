import { NextRequest, NextResponse } from 'next/server';
import { detectAdSlots } from '@/lib/detectSlots';
import { DetectionResult } from '@/types';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url, creativeWidth = 0, creativeHeight = 0, fileId = '', device = 'desktop' } = body as {
      url: string; creativeWidth?: number; creativeHeight?: number; fileId?: string;
      device?: 'mobile' | 'tablet' | 'desktop';
    };

    const VIEWPORTS = {
      mobile:  { width: 390,  height: 844  },
      tablet:  { width: 768,  height: 1024 },
      desktop: { width: 1440, height: 900  },
    };
    const viewport = VIEWPORTS[device] ?? VIEWPORTS.desktop;

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    // Basic URL validation
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return NextResponse.json({ error: 'Only HTTP and HTTPS URLs are allowed' }, { status: 400 });
    }

    // Block private/internal IPs in production only (SSRF protection)
    const isProduction = !!process.env.VERCEL;
    if (isProduction) {
      const hostname = parsedUrl.hostname.toLowerCase();
      const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
      const isPrivateRange = /^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/.test(hostname);

      if (blockedHosts.includes(hostname) || isPrivateRange) {
        return NextResponse.json({ error: 'Internal URLs are not allowed' }, { status: 400 });
      }
    }

    const { slots, screenshotBase64, pageWidth, pageHeight, pageHTML } = await detectAdSlots(url, creativeWidth, creativeHeight, fileId, viewport);

    const result: DetectionResult = {
      url,
      slots,
      screenshotBase64,
      pageWidth,
      pageHeight,
      pageHTML,
      detectedAt: new Date().toISOString(),
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error('Detection error:', err);
    const message = err instanceof Error ? err.message : 'Detection failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
