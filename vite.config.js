import { defineConfig, loadEnv } from 'vite';
 
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
 
  return {
    base: './',
    build: {
      outDir: 'dist',
      rollupOptions: {
        input: {
          main:      'index.html',
          dashboard: 'src/pages/admin/dashboard.html'
        }
      }
    },
    server: {
      hmr: {
        overlay: false, // desactiva el reload automático — errores visibles solo en consola
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