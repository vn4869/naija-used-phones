import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev we proxy /api/* to the local backend so we can use relative
// URLs everywhere. In production VITE_API_BASE_URL is set on Vercel.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
});
