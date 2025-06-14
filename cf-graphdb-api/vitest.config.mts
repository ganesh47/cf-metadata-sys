// vitest.config.mts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
const environment = process.env.WRANGLER_ENV ?? 'dev';
export default defineWorkersConfig({
	test: {
		environmentOptions:{
			bindings: {
				JWT_SECRET: process.env.JWT_SECRET ?? 'dummy-secret',
				INIT_DB: process.env.INIT_DB ?? 'false',
				TOGETHER_API_KEY: process.env.TOGETHER_API_KEY ?? '',
				QDRANT_API_KEY: process.env.QDRANT_API_KEY ?? '',
				QDRANT_EDGE_COLLECTION: process.env.QDRANT_EDGE_COLLECTION ?? '',
				QDRANT_URL: process.env.QDRANT_URL ?? '',
				OIDC_CLIENT_SECRET: process.env.OIDC_CLIENT_SECRET ?? '',
				OIDC_CLIENT_ID: process.env.OIDC_CLIENT_ID ?? '',
				OIDC_DISCOVERY_URL: process.env.OIDC_DISCOVERY_URL ?? '',
				KEYCLOAK_TEST_USER: process.env.OIDC_DISCOVERY_URL ?? '',
				KEYCLOAK_TEST_PASS: process.env.OIDC_DISCOVERY_URL ?? '',
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
