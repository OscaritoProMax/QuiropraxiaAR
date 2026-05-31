import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    base: '/',
    build: {
      outDir: 'dist',

      // 🛡️ Sin mapas de código fuente
      sourcemap: false,

      // 🛡️ Minificación agresiva
      minify: 'esbuild',

      rollupOptions: {
        input: {
          main:       resolve(__dirname, 'index.html'),
          dashboard:  resolve(__dirname, 'src/pages/admin/dashboard.html'),
          usuarios:   resolve(__dirname, 'src/pages/admin/usuarios.html'),
          informes:   resolve(__dirname, 'src/pages/admin/informes.html'),
          secretaria: resolve(__dirname, 'src/pages/secretaria/index.html'),
          callcenter: resolve(__dirname, 'src/pages/callcenter/index.html'),
        },

        // 🛡️ Ofuscación por fragmentación con hash
        output: {
          chunkFileNames: 'assets/js/[hash].js',
          entryFileNames: 'assets/js/[hash].js',
          assetFileNames: 'assets/[ext]/[hash].[ext]'
        }
      }
    },
    server: {
      hmr: {
        overlay: false,
      },
      proxy: {
        '/api/gemini': {
          target: 'https://generativelanguage.googleapis.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(
            /^\/api\/gemini/,
            `/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${env.VITE_GEMINI_KEY}`
          ),
        },
      },
    },
  };
});