// vitest.config.mts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
const environment = process.env.WRANGLER_ENV ?? 'dev';
export default defineWorkersConfig({
	test: {
		environmentOptions:{
			bindings: {
				JWT_SECRET: process.env.JWT_SECRET,
				INIT_DB: process.env.INIT_DB ?? 'false',
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
