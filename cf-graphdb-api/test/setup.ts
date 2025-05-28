// test/setup.ts - Create this file for test setup and teardown

import { SELF } from 'cloudflare:test';
import {Env, TraceContext} from "../src/types/graph";
import {Logger} from "../src/logger/logger";

export async function fetchValidAuthCode(env: Env) {
	const discoveryRes = await fetch(env.OIDC_DISCOVERY_URL)
	const oidc:any = await discoveryRes.json()

	const form = new URLSearchParams({
		grant_type: 'password',
		client_id: env.OIDC_CLIENT_ID,
		username: env.KEYCLOAK_TEST_USER,
		password: env.KEYCLOAK_TEST_PASS,
		scope: 'openid'
	})

	if (env.OIDC_CLIENT_SECRET) {
		form.append('client_secret', env.OIDC_CLIENT_SECRET)
	}

	const tokenRes = await fetch(oidc.token_endpoint, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: form
	})

	if (!tokenRes.ok) {
		const err = await tokenRes.text()
		throw new Error(`Token fetch failed: ${err}`)
	}

	return tokenRes.json()
}


/**
 * Cleans all data from the database (D1, KV, R2)
 */
export async function cleanAllData() {
  try {
    // Clear all nodes and edges from D1
    const response = await SELF.fetch('http://localhost/metadata/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Failed to clear database:', error);
      //throw new Error(`Failed to clear database: ${error}`);
    }

    console.log('✓ Database cleared successfully');
    return await response.json();
  } catch (error) {
    console.error('Error clearing test data:', error);
    //qthrow error;
  }
}
export const prepareLogger = () => {
	const LOG_LEVEL = 'info';
	const initStart = Date.now()
	const traceContext: TraceContext = {
		requestId: '',
		operation: '',
		startTime: Date.now(),
		metadata: {
			path: '',
			method: '',
			userAgent: '',
			contentType: ''
		}
	};
	const logger = new Logger(traceContext, LOG_LEVEL)
	return {initStart, logger};
};
