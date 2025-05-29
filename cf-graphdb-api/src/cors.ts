function corsHeaders(origin = "*"): Record<string, string> {
	return {
		"Access-Control-Allow-Origin": origin,
		"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
		"Access-Control-Allow-Credentials": "true",
	};
}

export async function applyCORS(res: Response, origin = "http://localhost:3000") {
	const headers = new Headers(res.headers);
	const cors = corsHeaders(origin);
	Object.entries(cors).forEach(([k, v]) => headers.set(k, v));
	return new Response(res.body, { ...res, headers });
}
