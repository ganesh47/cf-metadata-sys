declare const process: {
	env: {
		CI?: string;
		GITHUB_ACTIONS?: string;
		GITLAB_CI?: string;
		JENKINS_URL?: string;
		TRAVIS?: string;
		CF_PAGES?: string;
		NODE_ENV?: string;
	}
};
const isCI =  typeof process !== 'undefined' && process.env ?
	process.env.CI === 'true' ||
	process.env.GITHUB_ACTIONS === 'true' ||
	process.env.GITLAB_CI === 'true' ||
	process.env.JENKINS_URL !== undefined ||
	process.env.TRAVIS === 'true' ||
	process.env.CF_PAGES === 'true'||
	process.env.NODE_ENV === 'test': false;

// Generate timestamp-based version for CI environments
export const generateTimestampVersion = () => {
	const now = new Date();
	const day = String(now.getDate()).padStart(2, '0');
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const year = String(now.getFullYear()).slice(2);
	const hours = String(now.getHours()).padStart(2, '0');
	const minutes = String(now.getMinutes()).padStart(2, '0');

	return `v${day}${month}${year}${hours}${minutes}`;
};
export const DB_VERSION = isCI ? generateTimestampVersion() : 'v1'; // Current database schema version
export const NODES_TABLE = `nodes_${DB_VERSION}`;
export const EDGES_TABLE = `edges_${DB_VERSION}`;
