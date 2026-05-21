import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path'; // Aseguramos la importación de resolve

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    // 🎛️ CORRECCIÓN 1: Cambiado de './' a '/' para que las rutas de assets funcionen en cualquier nivel de subcarpeta
    base: '/', 
    build: {
      outDir: 'dist',
      
      // 🛡️ PROTECCIÓN 1: Desactivar mapas de código (Sourcemaps)
      sourcemap: false,
      
      // 🛡️ PROTECCIÓN 2: Minificación agresiva nativa
      minify: 'esbuild',
      
      rollupOptions: {
        input: {
          // 🎛️ CORRECCIÓN 2: Uso de resolve para asegurar que Rollup encuentre y compile los HTML
          main: resolve(__dirname, 'index.html'),
          dashboard: resolve(__dirname, 'src/pages/admin/dashboard.html'),
          
          // De una vez dejamos listos los accesos para los otros roles del Sprint 3:
         // secretaria: resolve(__dirname, 'src/pages/secretaria/dashboard.html'),
        //  callcenter: resolve(__dirname, 'src/pages/callcenter/dashboard.html')
        },
        
        // 🛡️ PROTECCIÓN 3: Ofuscación por fragmentación aleatoria (Code Splitting con Cifrado Hash)
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