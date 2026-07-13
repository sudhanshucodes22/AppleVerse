import { defineConfig } from 'vite';
import { resolve } from 'path';

// Security headers for the Vite dev/preview server.
// For production: configure on your CDN/server (Nginx, Vercel, Cloudflare, etc.)
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-DNS-Prefetch-Control': 'on',
};

export default defineConfig({
  server: {
    headers: SECURITY_HEADERS,
    // Transparently proxy all /api/* requests to Express backend
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          proxy.on('error', (err) => console.error('[vite-proxy] API proxy error:', err.message));
          proxy.on('proxyReq', (_, req) => console.log('[vite-proxy] →', req.method, req.url));
        },
      },
    },
  },

  preview: {
    headers: SECURITY_HEADERS,
  },

  build: {
    target: 'es2020',
    minify: 'esbuild',
    sourcemap: false, // Never expose source maps in production
    rollupOptions: {
      input: {
        main:        resolve(__dirname, 'index.html'),
        home:        resolve(__dirname, 'home.html'),
        mac:         resolve(__dirname, 'mac.html'),
        iphone:      resolve(__dirname, 'iphone.html'),
        ipad:        resolve(__dirname, 'ipad.html'),
        watch:       resolve(__dirname, 'watch.html'),
        audioVision: resolve(__dirname, 'audio-vision.html'),
        stores:      resolve(__dirname, 'stores.html'),
        login:       resolve(__dirname, 'login.html'),
        signup:      resolve(__dirname, 'signup.html'),
        account:     resolve(__dirname, 'account.html'),
      },
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
