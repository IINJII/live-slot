// This file is intentionally a thin wrapper so that @sparticuz/chromium
// is treated as a static import by Turbopack, making serverExternalPackages work.
// Do NOT inline this import into detectSlots.ts.
import chromium from '@sparticuz/chromium';
export default chromium;

// Remote URL for the chromium binary — used when the local bin/ dir is not available
// (i.e. when bundled by Turbopack/esbuild on Vercel). Must match the installed package version.
export const CHROMIUM_REMOTE_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v148.0.0/chromium-v148.0.0-pack.tar';
