import type { NextConfig } from 'next';

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
  allowedDevOrigins: ['192.168.1.12']
};
// module.exports = {
//   allowedDevOrigins: ['192.168.1.12'],
// }
export default nextConfig;
