// test/setup.ts - Create this file for test setup and teardown

import { SELF } from 'cloudflare:test';
import {TraceContext} from "../src/types/graph";
import {Logger} from "../src/logger/logger";

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
