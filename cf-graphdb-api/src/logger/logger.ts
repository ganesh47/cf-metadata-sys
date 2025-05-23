import {TraceContext} from "../types/graph";

const shouldLog = (logLevel: string, level: 'debug' | 'performance' | 'info' | 'warn' | 'error') => {
	const levels = {debug: 0, performance: 1, info: 2, warn: 3, error: 4};
	return levels[level] >= levels[logLevel as keyof typeof levels];
};

export class Logger {
	context: TraceContext;
	private logLevel: string;

	constructor(context: TraceContext, logLevel: string) {
		this.context = context;
		this.logLevel = logLevel;
	}

	info(message: string, data?: any): void {
		if (shouldLog(this.logLevel, 'info'))
			console.log(JSON.stringify({
				level: 'INFO',
				timestamp: new Date().toISOString(),
				requestId: this.context.requestId,
				operation: this.context.operation,
				message,
				data,
				elapsed_ms: Date.now() - this.context.startTime
			}));
	}

	error(message: string, error?: any): void {
		if (shouldLog(this.logLevel, 'error'))
			console.error(JSON.stringify({
				level: 'ERROR',
				timestamp: new Date().toISOString(),
				requestId: this.context.requestId,
				operation: this.context.operation,
				message,
				error: error?.message || error,
				stack: error?.stack,
				elapsed_ms: Date.now() - this.context.startTime
			}));
	}

	warn(message: string, data?: any): void {
		if (shouldLog(this.logLevel, 'warn'))
			console.warn(JSON.stringify({
				level: 'WARN',
				timestamp: new Date().toISOString(),
				requestId: this.context.requestId,
				operation: this.context.operation,
				message,
				data,
				elapsed_ms: Date.now() - this.context.startTime
			}));
	}

	debug(message: string, data?: any): void {
		if (shouldLog(this.logLevel, 'debug'))
			console.debug(JSON.stringify({
				level: 'DEBUG',
				timestamp: new Date().toISOString(),
				requestId: this.context.requestId,
				operation: this.context.operation,
				message,
				data,
				elapsed_ms: Date.now() - this.context.startTime
			}));
	}

	performance(operation: string, duration_ms: number, metadata?: any): void {
		if (shouldLog(this.logLevel, 'performance'))
			console.log(JSON.stringify({
				level: 'PERFORMANCE',
				timestamp: new Date().toISOString(),
				requestId: this.context.requestId,
				operation: `${this.context.operation}.${operation}`,
				duration_ms,
				metadata,
				total_elapsed_ms: Date.now() - this.context.startTime
			}));
	}
}
