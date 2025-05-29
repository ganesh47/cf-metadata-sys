import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
    plugins: [
        tsconfigPaths(),
        react() ,
    ],
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: './test/setup.ts',
        include: ['test/**/*.test.ts?(x)', 'src/**/*.test.ts?(x)'],
        coverage: {
            reporter: ['text', 'lcov'], // lcov is the Istanbul-compatible format
            reportsDirectory: './coverage' // default is ./coverage
        }
    }
})
