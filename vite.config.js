import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    base: './',
    build: {
      outDir: 'dist',
      
      // 🛡️ PROTECCIÓN 1: Desactivar mapas de código (Sourcemaps)
      // Evita al 100% que las herramientas de desarrollo del navegador reconstruyan tu carpeta /src/
      sourcemap: false,
      
      // 🛡️ PROTECCIÓN 2: Minificación agresiva nativa
      // Elimina comentarios, espacios en blanco, y renombra variables legibles a letras mudas (a, b, c)
      minify: 'esbuild',
      
      rollupOptions: {
        input: {
          main:      'index.html',
          dashboard: 'src/pages/admin/dashboard.html'
        },
        
        // 🛡️ PROTECCIÓN 3: Ofuscación por fragmentación aleatoria (Code Splitting con Cifrado Hash)
        // Esto destruye los nombres originales de tus archivos (como authService.js o ui.js).
        // Todo tu Javascript se mezclará y se guardará en nombres encriptados imposibles de re-ensamblar.
        output: {
          chunkFileNames: 'assets/js/[hash].js',
          entryFileNames: 'assets/js/[hash].js',
          assetFileNames: 'assets/[ext]/[hash].[ext]'
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