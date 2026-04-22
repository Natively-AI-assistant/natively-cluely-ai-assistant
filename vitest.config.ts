import path from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      'framer-motion': path.resolve(
        __dirname,
        './tests/mocks/framer-motion.mock.ts',
      ),
      ws: path.resolve(__dirname, './tests/mocks/audio/deepgram.mock.ts'),
      // Map all possible CredentialsManager paths to actual file
      '../services/CredentialsManager': path.resolve(
        __dirname,
        './electron/services/CredentialsManager.ts',
      ),
      '../../electron/services/CredentialsManager': path.resolve(
        __dirname,
        './electron/services/CredentialsManager.ts',
      ),
      'electron/services/CredentialsManager': path.resolve(
        __dirname,
        './electron/services/CredentialsManager.ts',
      ),
      premium: path.resolve(__dirname, './premium'),
    },
  },
  test: {
    projects: [
      {
        test: {
          name: 'renderer',
          globals: true,
          environment: 'jsdom',
          setupFiles: ['./tests/unit.setup.ts'],
          include: [
            'tests/unit/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
          ],
        },
      },
      {
        test: {
          name: 'electron',
          globals: true,
          environment: 'node',
          setupFiles: ['./tests/electron.setup.ts'],
          include: [
            'tests/electron/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
          ],
        },
      },
      {
        test: {
          name: 'integration',
          globals: true,
          environment: 'node',
          setupFiles: ['./tests/integration.setup.ts'],
          include: [
            'tests/integration/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
          ],
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'mocks',
          globals: true,
          environment: 'jsdom',
          include: [
            'tests/mocks/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
          ],
        },
      },
      {
        test: {
          name: 'msw',
          globals: true,
          environment: 'node',
          include: [
            'tests/msw/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
          ],
        },
      },
      {
        test: {
          name: 'fixtures',
          globals: true,
          environment: 'node',
          include: [
            'tests/fixtures/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
          ],
        },
      },
      {
        test: {
          name: 'coverage',
          globals: true,
          environment: 'node',
          include: [
            'tests/coverage/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
          ],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        // Global fallback thresholds — raised from 60% to 75%
        lines: 75,
        functions: 75,
        branches: 75,
        statements: 75,
        // Per-directory overrides — raised targets
        'src/utils/**': {
          lines: 95,
          functions: 95,
          branches: 95,
          statements: 95,
        },
        'src/hooks/**': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
        'src/components/**': {
          lines: 80,
          functions: 80,
          branches: 80,
          statements: 80,
        },
        'src/services/**': {
          lines: 85,
          functions: 85,
          branches: 85,
          statements: 85,
        },
        'electron/**': {
          lines: 80,
          functions: 80,
          branches: 80,
          statements: 80,
        },
      },
    },
  },
})
