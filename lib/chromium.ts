// This file is intentionally a thin wrapper so that @sparticuz/chromium
// is treated as a static import by Turbopack, making serverExternalPackages work.
// Do NOT inline this import into detectSlots.ts.
import chromium from '@sparticuz/chromium';
export default chromium;
