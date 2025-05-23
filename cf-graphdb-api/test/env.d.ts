// test/env.d.ts
import type { Env } from '../worker-configuration';

declare module 'cloudflare:test' {
	interface ProvidedEnv extends Env {
		// Add any test-specific bindings here
		TEST_NAMESPACE?: KVNamespace;
	}
}
