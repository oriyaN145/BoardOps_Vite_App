import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/Board_Vite_App/', // 👈 critical for GitHub Pages
})
