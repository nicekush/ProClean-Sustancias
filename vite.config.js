import {defineConfig} from 'vite';
import {resolve} from 'node:path';
export default defineConfig({root:'web',build:{outDir:'../dist',emptyOutDir:true,rollupOptions:{input:{operator:resolve('web/index.html'),admin:resolve('web/admin.html')}}}});
