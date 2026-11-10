import { type H3Event, handleCors } from "h3";

/** Returns the preflight response when there is one. */
export function applyCors(
	event: H3Event,
	corsOrigin: string | false | undefined,
): unknown {
	if (!corsOrigin) return undefined;
	return (
		handleCors(event, {
			origin: corsOrigin as "*",
			methods: "*",
			preflight: { statusCode: 204 },
		}) || undefined
	);
}
