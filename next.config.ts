import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */

  // Design 2.4: Next verifies the Origin header against Host on every server
  // action invocation as CSRF protection, but this check requires explicit
  // configuration when the app runs behind a reverse proxy/CDN (Vercel).
  // No production URL exists yet (not deployed) — add the Vercel production
  // origin here once deployed.
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost:3000"],
    },
  },

  // Design 8.3: secure-coding rule 32's full 8-header list, minus
  // Content-Security-Policy (deliberately deferred — see design section 9;
  // a correct CSP needs per-request nonces threaded through the proxy, and a
  // wrong one silently breaks the app).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            // Safe here specifically because the OAuth flow (design 4.3) is
            // a full-page redirect, not a popup — no popup-communication
            // flow for COOP's browsing-context isolation to break.
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
          {
            key: "Cross-Origin-Resource-Policy",
            value: "same-origin",
          },
        ],
      },
      {
        // Secure-coding rule 31: no-store on responses carrying sensitive
        // data. /dashboard renders the DJ's name, business name, and phone
        // (design 8.3). Scoped to this path only — other routes like the
        // public homepage keep normal caching behavior.
        source: "/dashboard",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
