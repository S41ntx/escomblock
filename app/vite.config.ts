import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// `vite build --mode artifact` produces one self-contained, demo-only HTML file
// (dist-artifact/index.html) that can be hosted anywhere without a server.
export default defineConfig(({ mode }) => ({
  plugins: mode === 'artifact' ? [react(), viteSingleFile()] : [react()],
  define: mode === 'artifact' ? { 'import.meta.env.VITE_FORCE_DEMO': JSON.stringify('1') } : {},
  build: {
    outDir: mode === 'artifact' ? 'dist-artifact' : 'dist',
    chunkSizeWarningLimit: 1500,
  },
}))
