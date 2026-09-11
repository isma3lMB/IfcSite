import { execSync } from 'node:child_process';
import type { NextConfig } from 'next';

/** '' when git is missing — some static hosts build from a tarball with no .git. */
function git(args: string): string {
  try {
    return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

/**
 * The version shown in the info panel: the commit the build came from, and that
 * commit's date. Hosts that build without a .git hand the SHA over in their own
 * variable instead (Vercel, GitHub Actions, Cloudflare Pages, Netlify).
 */
const commit =
  git('rev-parse --short HEAD') ||
  (
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.GITHUB_SHA ??
    process.env.CF_PAGES_COMMIT_SHA ??
    process.env.COMMIT_REF ??
    ''
  ).slice(0, 7);
const commitDate = git('log -1 --format=%cI') || new Date().toISOString();

/**
 * Static export: `next build` writes a plain directory of HTML/JS to out/ with
 * no server runtime. There are deliberately no route handlers anywhere in this
 * app — every request (Overpass, IGN Géoplateforme, Nominatim, Terrarium) goes
 * straight from the browser to a service that sends
 * Access-Control-Allow-Origin: *, exactly as the original single-file page did.
 *
 * Serve out/ over HTTP. Opening out/index.html via file:// gives the page a
 * null origin, which Overpass rejects — you get an empty result rather than an
 * error, which is much harder to diagnose.
 */
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  experimental: {
    // TypeScript 7 is a native binary and no longer exposes the JS compiler API
    // Next reaches for by default; this routes type checking through the CLI.
    useTypeScriptCli: true,
  },
  allowedDevOrigins: ['192.168.1.12'],
  // Inlined into the client bundle at build time — read through lib/version.ts.
  env: {
    NEXT_PUBLIC_COMMIT: commit,
    NEXT_PUBLIC_COMMIT_DATE: commitDate,
  },
};

export default nextConfig;
