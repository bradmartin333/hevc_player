import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages uses /<repo-name>/ as base path
  // Change this to your repository name
  base: process.env.NODE_ENV === 'production' ? '/hevc_player/' : '/',
  
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // Generate sourcemaps for debugging
    sourcemap: true,
  },

  server: {
    // Development server configuration
    port: 5173,
    open: true,
  },
});
