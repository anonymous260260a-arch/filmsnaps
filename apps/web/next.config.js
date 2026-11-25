/** @type {import('next').NextConfig} */
// Local dev: bind Cloudflare resources (D1 TELEMETRY_DB etc.) via the
// OpenNext platform proxy — required for getCloudflareContext() in dev.
// No-op in production builds (the Worker provides real bindings).
//
// Two guards keep every build deterministic (never needs wrangler auth):
//   - BUILD_FOR_DESKTOP=true (static export) has no Cloudflare context at
//     runtime — skip the init entirely, or `pnpm dist` dials out and crashes.
//   - Remote (account-bound) dev bindings are opt-in via
//     NEXT_DEV_REMOTE_BINDINGS=true. Default is local miniflare simulation,
//     so builds/dev runs work offline with an expired wrangler token.
if (process.env.BUILD_FOR_DESKTOP !== "true") {
  require("@opennextjs/cloudflare").initOpenNextCloudflareForDev({
    remoteBindings: process.env.NEXT_DEV_REMOTE_BINDINGS === "true",
  });
}

const IS_DESKTOP = process.env.BUILD_FOR_DESKTOP === "true";

const nextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: require("./package.json").version,
  },
  // Desktop: static export (no Node.js server, <200ms cold start in Electron).
  // Web/mobile: default server mode (SSR + API routes).
  output: IS_DESKTOP ? "export" : undefined,
  // Desktop export: drop the "ts" page extension so app/api/**/route.ts
  // handlers are excluded — API routes are server-only and cannot be
  // statically exported (force-dynamic breaks the export collector). The
  // desktop shell calls the deployed Worker for everything dynamic instead.
  // All pages/layouts/loadings are .tsx, so they are unaffected; a future
  // .ts PAGE would need renaming to .tsx.
  pageExtensions: IS_DESKTOP ? ["tsx", "jsx", "js"] : undefined,
  reactStrictMode: true,
  allowedDevOrigins: ["192.168.100.7"],

  // Workspace packages must be transpiled for webpack to resolve them in pnpm monorepos.
  transpilePackages: ["@filmsnaps/shared"],
  // Performance optimizations
  poweredByHeader: false,
  compress: true,

  // Production optimizations
  productionBrowserSourceMaps: false,

  // Images: no server-side optimizer on ANY target.
  // Why: the Cloudflare deployment (OpenNext Worker) runs /_next/image
  // server-side, and image.tmdb.org 403-blocks Worker egress IPs — every
  // uncached poster/backdrop failed (only previously edge-cached ones
  // loaded; Netlify works because its runtime fetches from Netlify egress).
  // With unoptimized, next/image renders the TMDB URL directly and the
  // BROWSER fetches it — image.tmdb.org serves browsers fine (the desktop
  // export and mobile app already worked this way). The optimizer's
  // resizing was redundant anyway: components request pre-sized TMDB paths
  // (w92/w500/w1280/original). Cost: no avif/webp re-encode, images ship
  // as jpeg — worth it for images that actually load.
  images: { unoptimized: true },

  // Webpack optimizations
  webpack: (config, { dev, isServer }) => {
    if (!dev && !isServer) {
      config.optimization = {
        ...config.optimization,
        minimize: true,
        moduleIds: "deterministic",
        runtimeChunk: "single",
        splitChunks: {
          chunks: "all",
          // No forced `vendors` group: `test: node_modules` + `name` + the
          // `all` chunk scope merges even lazy-only libraries into one chunk
          // that every page preloads — including the mpv player stack
          // (movi-player, dashjs, shaka), which only /watch imports. That put
          // ~5 MB of JavaScript on the startup path of every launch. Next's
          // defaults keep async-only dependencies in the chunk that imports
          // them.
          cacheGroups: {
            common: {
              minChunks: 2,
              priority: 5,
              reuseExistingChunk: true,
            },
          },
        },
      };
    }

    return config;
  },

  // Headers for performance
  async headers() {
    // Desktop static export: headers() is a server feature and is skipped in
    // export builds — guard so `BUILD_FOR_DESKTOP=true next build` stays clean.
    const corsHeaders = IS_DESKTOP
      ? []
      : [
          {
            // The Electron desktop app loads its UI from the app:// protocol
            // (static export) and fetches APIs from this server. Without an
            // explicit ACAO for that origin, every /api call from the desktop
            // shell dies to CORS (non-dev mode).
            source: "/api/:path*",
            headers: [
              { key: "Access-Control-Allow-Origin", value: "app://index.html" },
              {
                key: "Access-Control-Allow-Methods",
                value: "GET,POST,PUT,DELETE,OPTIONS",
              },
              {
                key: "Access-Control-Allow-Headers",
                value: "Content-Type,Authorization",
              },
            ],
          },
        ];
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "X-DNS-Prefetch-Control",
            value: "on",
          },

          {
            key: "X-Frame-Options",
            value: "SAMEORIGIN",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "origin-when-cross-origin",
          },
        ],
      },
      {
        source: "/images/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      ...corsHeaders,
    ];
  },

  turbopack: {},

  experimental: {
    optimizePackageImports: ["lucide-react", "@radix-ui/react-icons"],
  },
};

module.exports = nextConfig;
