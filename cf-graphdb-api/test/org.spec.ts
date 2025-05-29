import {beforeEach, describe, expect, it, vi} from "vitest";
import {getOrgs} from "../src/org"; // adjust path if needed
import {env as eenv} from "cloudflare:test"
import {jwtVerify} from "jose";

vi.mock("jose", () => {
	return {
		createRemoteJWKSet: vi.fn(() => "mocked-jwks-set"),
		jwtVerify: vi.fn(),
	};
});

vi.mock("@/lib/cors", () => ({
	applyCORS: vi.fn((res: Response) => {
		return new Response("CORS-wrapped: " + res.body, res);
	}),
}));

describe("getOrgs", () => {
	const env = {
		OIDC_DISCOVERY_URL: "https://fake-issuer/.well-known/openid-configuration",
		OIDC_CLIENT_ID: "cf-graphdb-app",
		CORS_ALLOWED_ORIGINS: undefined,
	};

	const logger = {
		log: vi.fn(),
	};

	const params = {};

	beforeEach(() => {
		vi.resetAllMocks();
		global.fetch = vi.fn();
	});

	it("returns 401 if no session cookie is present", async () => {
		const req = new Request("https://dummy", {
			headers: new Headers(),
		});

		// @ts-ignore
		const res = await getOrgs(req, env, logger as any, params);
		expect(res.status).toBe(401);
	});

	it("returns 401 if JWT verification fails", async () => {
		const req = new Request("https://dummy", {
			headers: new Headers({
				Cookie: "session=invalid.token",
			}),
		});

		(global.fetch as any).mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				jwks_uri: "https://fake-jwks",
				issuer: "https://fake-issuer",
			}),
		});

		(jwtVerify as any).mockRejectedValue(new Error("Invalid token"));

		// @ts-ignore
		const res = await getOrgs(req, env, logger as any, params);
		expect(res.status).toBe(401);
	});

	it("returns list of orgs from JWT permissions", async () => {
		const req = new Request("https://dummy", {
			headers: new Headers({
				Cookie: "session=valid.jwt.token",
			}),
		});

		(global.fetch as any).mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				jwks_uri: "https://fake-jwks",
				issuer: "https://fake-issuer",
			}),
		});

		(jwtVerify as any).mockResolvedValueOnce({
			payload: {
				permissions: ["orgA:read", "orgA:write", "orgB:read"],
			},
		});

		// @ts-ignore
		const res = await getOrgs(req, env, logger as any, params);
		const data:any = await res.json();
		expect(data.orgs.sort()).toEqual(["orgA", "orgB"]);
	});

	it("wraps response with CORS if env.CORS_ALLOWED_ORIGINS is set", async () => {
		const req = new Request("https://dummy", {
			headers: new Headers({
				Cookie: "session=valid.jwt.token",
			}),
		});

		(global.fetch as any).mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				jwks_uri: "https://fake-jwks",
				issuer: "https://fake-issuer",
			}),
		});

		(jwtVerify as any).mockResolvedValueOnce({
			payload: {
				permissions: ["orgX:read"],
			},
		});


		// @ts-ignore
		const res = await getOrgs(req, eenv, logger as any, params);
		await res.text();
// @ts-ignore
		expect(res.headers.get("Access-Control-Allow-Origin")).toBe(eenv.CORS_ALLOWED_ORIGINS);
	});
});
