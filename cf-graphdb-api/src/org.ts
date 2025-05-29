import {Env, OrgParams} from "./types/graph";
import {Logger} from "./logger/logger";
import {createRemoteJWKSet, jwtVerify} from "jose";
import {applyCORS} from "./cors";

function parseCookie(header: string): Record<string, string> {
	return Object.fromEntries(
		header.split(";").map((c) => {
			const [key, ...v] = c.trim().split("=");
			return [key, decodeURIComponent(v.join("="))];
		})
	);
}

export async function getOrgs(request: Request, env: Env, _logger: Logger, _params: OrgParams) {
	const cookieHeader = request.headers.get("Cookie") || "";
	const sessionToken = parseCookie(cookieHeader)["session"];
	if (!sessionToken) {
		return new Response("Unauthorized", {status: 401});
	}
	const oidcRes = await fetch(env.OIDC_DISCOVERY_URL)
	if (!oidcRes.ok) throw new Error('Failed to load OIDC config')

	try {
		const oidc: any = await oidcRes.json()

		const JWKS = createRemoteJWKSet(new URL(oidc.jwks_uri));

		const {payload} = await jwtVerify(sessionToken, JWKS, {
			issuer: oidc.issuer,
			audience: env.OIDC_CLIENT_ID,
		});

		const permissions = payload.permissions as string[] | undefined;
		const orgs = new Set<string>();

		permissions?.forEach((perm) => {
			const [org] = perm.split(":");
			if (org) orgs.add(org);
		});
		if (env.CORS_ALLOWED_ORIGINS)
			return applyCORS(Response.json({orgs: Array.from(orgs)}))
		else
			return Response.json({orgs: Array.from(orgs)});
	} catch (err) {
		console.error("JWT validation failed:", err);
		return new Response("Unauthorized", {status: 401});
	}
}
