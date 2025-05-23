// vitest.config.mts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
const environment = process.env.WORKER_ENV ?? 'dev';
export default defineWorkersConfig({
	test: {
		environmentOptions:{
			bindings: {
				JWT_SECRET: process.env.JWT_SECRET,
			}
		},
		poolOptions: {
			workers: {
				wrangler: {
					configPath: './wrangler.jsonc',
					environment: environment
				},
			},
		},
		coverage: {
			provider:'istanbul',
			reporter: ['text', 'json', 'html','lcov'],
			exclude: [
				'node_modules/',
				'dist/',
				'coverage/',
				'**/*.test.ts'
			]
		}
	}
});
