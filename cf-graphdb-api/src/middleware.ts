// Apply middleware and then call the handler
import {RouteHandler} from "./routes";
import {Env, OrgParams} from "./types/graph";
import {Logger} from "./logger/logger";
import {applyCORS} from "./cors";

export const applyMiddleware = async (
	middleware: Middleware,
	handler: RouteHandler,
	request: Request,
	env: Env,
	logger: Logger,
	params?: Record<string, string>
): Promise<Response> => {
	const next = async (req: Request) => handler(req, env, logger, params as OrgParams);
	const response = await middleware(request, env, logger, next, params as OrgParams);
	if (env.CORS_ALLOWED_ORIGINS)
		return applyCORS(response);
	else
		return response;
};
type Middleware = (
	request: Request,
	env: Env,
	logger: Logger,
	next: (request: Request) => Promise<Response>,
	params: OrgParams
) => Promise<Response>;
