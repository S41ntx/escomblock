import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: loadEnv(mode, process.cwd(), 'VITE_').VITE_BASE || '/',
  build: {
    chunkSizeWarningLimit: 1500,
  },
}))
