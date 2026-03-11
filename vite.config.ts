<<<<<<< HEAD
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
=======
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import path from "path"
import { defineConfig, loadEnv } from "vite"

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "")

  return {
    plugins: [
      react(),
      tailwindcss()
    ],

    define: {
      "process.env.GEMINI_API_KEY": JSON.stringify(env.GEMINI_API_KEY)
    },

    resolve: {
      alias: {
        "@": path.resolve(__dirname, ".")
      }
    },

    server: {
      hmr: process.env.DISABLE_HMR !== "true"
    },

    build: {
      rollupOptions: {
        external: ["/pagefind/pagefind.js"]
      }
    }
  }
})
>>>>>>> eaffcb4e7892a08afee9778f4ea3ff374522b3b6
