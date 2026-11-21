import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	IN8nHttpFullResponse,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

export const BASE_URL = 'https://api.ktemia.com';
export const CREDENTIAL_NAME = 'ktemiaApi';

const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_SERVER_RETRIES = 1;
const MAX_RETRY_AFTER_SECONDS = 60;
const DEFAULT_RETRY_AFTER_SECONDS = 1;
const SERVER_RETRY_DELAY_MS = 1000;

/** Indirection so tests can observe waits instead of sleeping. */
export const timing = {
	sleep: async (ms: number): Promise<void> => {
		await sleep(ms);
	},
};

/** An error answered by the Ktemia API, carrying its stable error code. */
export class KtemiaApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly param?: string;
	readonly body?: JsonObject;

	constructor(opts: { status: number; code: string; message: string; param?: string; body?: JsonObject }) {
		super(opts.message);
		this.name = 'KtemiaApiError';
		this.status = opts.status;
		this.code = opts.code;
		this.param = opts.param;
		this.body = opts.body;
	}
}

/** Input the node rejected before calling the API, so no quota was spent. */
export class KtemiaValidationError extends Error {
	readonly param: string;

	constructor(param: string, message: string) {
		super(message);
		this.name = 'KtemiaValidationError';
		this.param = param;
	}
}

function parseBody(raw: unknown): unknown {
	if (typeof raw !== 'string') return raw;
	if (raw === '') return undefined;
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}

function toApiError(status: number, body: unknown): KtemiaApiError {
	if (typeof body === 'object' && body !== null) {
		const error = (body as { error?: unknown }).error;
		if (typeof error === 'object' && error !== null) {
			const { code, message, param } = error as Record<string, unknown>;
			if (typeof code === 'string' && typeof message === 'string') {
				return new KtemiaApiError({
					status,
					code,
					message,
					param: typeof param === 'string' ? param : undefined,
					body: body as JsonObject,
				});
			}
		}
	}
	return new KtemiaApiError({
		status,
		code: status >= 500 ? 'UPSTREAM_ERROR' : 'REQUEST_FAILED',
		message: `Ktemia API returned HTTP ${status}`,
	});
}

/** Retry-After is seconds or an HTTP date. Capped so a bad header cannot stall a workflow. */
export function retryAfterMs(headers: IDataObject | undefined): number {
	const raw = headers?.['retry-after'] ?? headers?.['Retry-After'];
	let seconds = DEFAULT_RETRY_AFTER_SECONDS;
	if (raw !== undefined && raw !== null && raw !== '') {
		const value = String(raw).trim();
		const asNumber = Number(value);
		if (Number.isFinite(asNumber)) {
			seconds = asNumber;
		} else {
			const at = Date.parse(value);
			if (!Number.isNaN(at)) seconds = (at - Date.now()) / 1000;
		}
	}
	return Math.round(Math.min(Math.max(seconds, 0), MAX_RETRY_AFTER_SECONDS) * 1000);
}

/**
 * Calls the Ktemia API. Resolves to the parsed JSON body, or to the API error.
 *
 * RATE_LIMIT_EXCEEDED waits for Retry-After and retries up to 3 times.
 * QUOTA_EXCEEDED never retries: the monthly allowance is gone.
 * A 5xx retries once.
 */
async function send(
	this: IExecuteFunctions,
	method: IHttpRequestMethods,
	path: string,
	options: { qs?: IDataObject; body?: IDataObject },
): Promise<IDataObject | KtemiaApiError> {
	const request: IHttpRequestOptions = {
		method,
		url: `${BASE_URL}${path}`,
		headers: { Accept: 'application/json' },
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		// The API key must never follow a redirect to another host.
		disableFollowRedirect: true,
	};
	if (options.qs && Object.keys(options.qs).length > 0) request.qs = options.qs;
	if (options.body !== undefined) request.body = options.body;

	let rateLimitRetries = 0;
	let serverRetries = 0;
	const maxAttempts = 1 + MAX_RATE_LIMIT_RETRIES + MAX_SERVER_RETRIES;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const response = (await this.helpers.httpRequestWithAuthentication.call(
			this,
			CREDENTIAL_NAME,
			request,
		)) as IN8nHttpFullResponse;
		const status = response.statusCode;
		const body = parseBody(response.body);

		if (status >= 200 && status < 300) {
			return (body ?? {}) as IDataObject;
		}

		const error = toApiError(status, body);
		if (
			status === 429 &&
			error.code !== 'QUOTA_EXCEEDED' &&
			rateLimitRetries < MAX_RATE_LIMIT_RETRIES
		) {
			rateLimitRetries++;
			await timing.sleep(retryAfterMs(response.headers));
			continue;
		}
		if (status >= 500 && serverRetries < MAX_SERVER_RETRIES) {
			serverRetries++;
			await timing.sleep(SERVER_RETRY_DELAY_MS);
			continue;
		}
		return error;
	}
	return new KtemiaApiError({ status: 0, code: 'UPSTREAM_ERROR', message: 'Ktemia API did not answer' });
}

type RequestOptions = { qs?: IDataObject; body?: IDataObject };

/** Calls the Ktemia API and returns the parsed JSON body. Throws KtemiaApiError on failure. */
export async function ktemiaRequest(
	this: IExecuteFunctions,
	method: IHttpRequestMethods,
	path: string,
	options: RequestOptions = {},
): Promise<IDataObject> {
	const result = await send.call(this, method, path, options);
	if (result instanceof KtemiaApiError) throw result;
	return result;
}

/**
 * Like ktemiaRequest, but an error whose code is in `emptyCodes` (NO_RESULTS,
 * NO_MORE_RESULTS) is an empty answer rather than a failure.
 */
export async function ktemiaRequestOrEmpty(
	this: IExecuteFunctions,
	method: IHttpRequestMethods,
	path: string,
	options: RequestOptions,
	emptyCodes: string[],
): Promise<{ body: IDataObject } | { empty: KtemiaApiError }> {
	const result = await send.call(this, method, path, options);
	if (result instanceof KtemiaApiError) {
		if (emptyCodes.includes(result.code)) return { empty: result };
		throw result;
	}
	return { body: result };
}

const PRICING_URL = 'https://www.ktemia.com/pricing/';
const KEYS_URL = 'https://app.ktemia.com/api-keys';

function describe(error: KtemiaApiError): string | undefined {
	switch (error.code) {
		case 'MISSING_API_KEY':
		case 'INVALID_API_KEY':
			return `Check the API key in the Ktemia API credential. Create a key at ${KEYS_URL}.`;
		case 'KEY_REVOKED':
			return `This API key was revoked. Create a new one at ${KEYS_URL} and update the credential.`;
		case 'QUOTA_EXCEEDED':
			return `The monthly request quota is used up, so the node did not retry. Every key on the account shares the quota, so another key will not help. Run Account > Get Key Status (free) to see the reset date, or upgrade at ${PRICING_URL}.`;
		case 'RATE_LIMIT_EXCEEDED':
			return 'Still rate limited after 3 retries. Slow the workflow down, or upgrade for a higher per-second limit.';
		case 'SEARCH_EXPIRED':
			return 'Search tokens expire 60 minutes after the search starts. Run the search again.';
		case 'INVALID_SEARCH_TOKEN':
			return 'Use the searchToken or nextToken from a Search or Get Next Page output.';
		default:
			break;
	}
	if (error.param) return `Fix the "${error.param}" field.`;
	if (error.status >= 500) return 'The travel provider did not answer, even after one retry. Try again in a minute.';
	return undefined;
}

/** Turns anything thrown while handling an item into the n8n error to show. */
export function toNodeError(
	this: IExecuteFunctions,
	error: unknown,
	itemIndex: number,
): NodeApiError | NodeOperationError {
	if (error instanceof NodeApiError || error instanceof NodeOperationError) return error;
	if (error instanceof KtemiaValidationError) {
		return new NodeOperationError(this.getNode(), error.message, {
			itemIndex,
			description: `Fix the "${error.param}" field. Nothing was sent to Ktemia, so no quota was used.`,
		});
	}
	if (error instanceof KtemiaApiError) {
		return new NodeApiError(this.getNode(), error.body ?? { code: error.code, message: error.message }, {
			itemIndex,
			message: `${error.code}: ${error.message}`,
			description: describe(error),
			httpCode: error.status ? String(error.status) : undefined,
		});
	}
	return new NodeApiError(this.getNode(), error as JsonObject, { itemIndex });
}

// ── Input helpers ────────────────────────────────────────────────────────────

/** Splits "a, b,c" (or an array) into trimmed, non-empty strings. */
export function toList(value: unknown): string[] {
	const parts = Array.isArray(value) ? value : String(value ?? '').split(',');
	return parts.map((part) => String(part).trim()).filter((part) => part !== '');
}

function todayMinusOneUtc(): string {
	const now = new Date();
	now.setUTCDate(now.getUTCDate() - 1);
	return now.toISOString().slice(0, 10);
}

/**
 * Normalises a date parameter to YYYY-MM-DD and rejects past dates.
 *
 * Accepts the n8n date picker value, a plain date string, or a Luxon DateTime
 * from an expression. One day of slack covers time zones behind UTC.
 */
export function toDate(value: unknown, param: string, { allowPast = false } = {}): string {
	let text: string | undefined;
	if (typeof value === 'string') {
		text = value.trim();
	} else if (value instanceof Date) {
		text = value.toISOString();
	} else if (typeof value === 'object' && value !== null && 'toISODate' in value) {
		const iso = (value as { toISODate: () => string | null }).toISODate();
		text = iso ?? undefined;
	}
	const match = text ? /^(\d{4})-(\d{2})-(\d{2})/.exec(text) : null;
	if (!match) {
		throw new KtemiaValidationError(param, `${param} must be a date like 2026-12-03`);
	}
	const [, year, month, day] = match;
	const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
	const normalised = `${year}-${month}-${day}`;
	if (date.toISOString().slice(0, 10) !== normalised) {
		throw new KtemiaValidationError(param, `${param} is not a real calendar date: ${normalised}`);
	}
	if (!allowPast && normalised < todayMinusOneUtc()) {
		throw new KtemiaValidationError(param, `${param} is in the past: ${normalised}`);
	}
	return normalised;
}

/** IATA airport or city code: 3 or 4 letters. */
export function toPlaceCode(value: unknown, param: string): string {
	const code = String(value ?? '').trim().toUpperCase();
	if (!/^[A-Z]{3,4}$/.test(code)) {
		throw new KtemiaValidationError(
			param,
			`${param} must be a 3 or 4 letter IATA airport or city code, such as JFK or NYC. Use Lookup > Find Airport or City to get one.`,
		);
	}
	return code;
}

export function requireText(value: unknown, param: string, hint: string): string {
	const text = String(value ?? '').trim();
	if (text === '') throw new KtemiaValidationError(param, `${param} is required. ${hint}`);
	return text;
}
