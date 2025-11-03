import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  // GitHub Pages uses /<repo-name>/ as base path
  // Change this to your repository name
  base: process.env.NODE_ENV === 'production' ? '/hevc_player/' : '/',

  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // Generate sourcemaps for debugging
    sourcemap: true,
    // Multi-page build configuration
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        zoomPan: resolve(__dirname, 'src/controls/zoom-pan.html'),
      },
    },
  },

  server: {
    // Development server configuration
    port: 5173,
    open: true,
  },
});
