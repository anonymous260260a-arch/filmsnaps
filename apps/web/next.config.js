/** @type {import('next').NextConfig} */
const IS_DESKTOP = process.env.BUILD_FOR_DESKTOP === "true";

const nextConfig = {
  // Desktop: static export (no Node.js server, <200ms cold start in Electron).
  // Web/mobile: default server mode (SSR + API routes).
  output: IS_DESKTOP ? "export" : undefined,
  reactStrictMode: true,
  allowedDevOrigins: ["192.168.100.7"],

  // Workspace packages must be transpiled for webpack to resolve them in pnpm monorepos.
  transpilePackages: ["@filmsnaps/shared"],
  // Performance optimizations
  poweredByHeader: false,
  compress: true,

  // Production optimizations
  productionBrowserSourceMaps: false,

  // Optimize images — static export requires unoptimized (images served from CDNs)
  images: IS_DESKTOP
    ? { unoptimized: true }
    : {
        formats: ["image/avif", "image/webp"],
        deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
        imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
        minimumCacheTTL: 60 * 60 * 24 * 30, // 30 days
        qualities: [75, 85, 90],
        remotePatterns: [
          {
            protocol: "https",
            hostname: "image.tmdb.org",
            pathname: "/t/p/**",
          },
          {
            // AniList cover CDN — anime search results only
            protocol: "https",
            hostname: "s4.anilist.co",
            pathname: "/file/anilistcdn/**",
          },
        ],
      },

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
          cacheGroups: {
            vendor: {
              test: /[\\/]node_modules[\\/]/,
              name: "vendors",
              priority: 10,
            },
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
