import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base must match the GitHub Pages repo path: https://<user>.github.io/world-cup/
export default defineConfig({
  base: '/world-cup/',
  plugins: [react()],
});
