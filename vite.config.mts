/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'
import { version } from './package.json'
import 'dotenv/config'

// Inject version so the React frontend can read it via import.meta.env.VITE_APP_VERSION
process.env.VITE_APP_VERSION = version;

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    base: './', // Use relative paths for Electron
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
            "@hooks": path.resolve(__dirname, "./src/hooks"),
            "@config": path.resolve(__dirname, "./src/config"),
        },
    },
    server: {
        port: 5180,
        host: process.env.DEV_HOST || 'localhost',
    },
    build: {
        chunkSizeWarningLimit: 1000,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes('node_modules')) {
                        if (id.includes('react') || id.includes('react-dom') || id.includes('framer-motion')) {
                            return 'vendor'
                        }
                        if (id.includes('lucide-react') || id.includes('@radix-ui')) {
                            return 'ui'
                        }
                    }
                }
            }
        }
    },
})
