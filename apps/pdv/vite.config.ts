import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Loja ERP',
        short_name: 'Loja',
        display: 'standalone',
        start_url: '/',
        background_color: '#ffffff',
        theme_color: '#111111',
      },
    }),
  ],
});
