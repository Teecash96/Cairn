import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  build: {
    // Do not publish source maps. The public bundle is already minified and
    // readable error messages do not require exposing the source tree.
    sourcemap: false,
    target: 'es2020',
  },
  server: {
    // `host: true` exposes the dev server on the LAN so Nimiq Pay on a phone
    // can reach it. Open http://<your-lan-ip>:5173 in Nimiq Pay > Mini Apps.
    host: true,
    port: 5173,
  },
})
