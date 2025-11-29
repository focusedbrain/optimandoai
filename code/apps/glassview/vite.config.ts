import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@lib': path.resolve(__dirname, '../../packages/code-block-library/src/components'),
      '@lib-root': path.resolve(__dirname, '../../packages/code-block-library/src'),
      '@services': path.resolve(__dirname, './src/services'),
    },
  },
  define: {
    'process.env': {},
  },
  server: {
    port: 5173,
    host: true,
    open: true,
    fs: {
      allow: [
        '..',
        path.resolve(__dirname, '../../packages/code-block-library')
      ]
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          charts: ['chart.js', 'react-chartjs-2'],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'chart.js', 'react-chartjs-2'],
  },
});