import { NextRequest, NextResponse } from 'next/server';
import { deleteTmpFile } from '@/lib/fileManager';

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { fileId } = body as { fileId: string };

    if (!fileId) {
      return NextResponse.json({ error: 'fileId is required' }, { status: 400 });
    }

    // Basic validation — fileId should be a UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(fileId)) {
      return NextResponse.json({ error: 'Invalid fileId' }, { status: 400 });
    }

    const deleted = deleteTmpFile(fileId);

    return NextResponse.json({ success: deleted, fileId });
  } catch (err) {
    console.error('Cleanup error:', err);
    return NextResponse.json({ error: 'Cleanup failed' }, { status: 500 });
  }
}
