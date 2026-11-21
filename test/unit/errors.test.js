'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { run, runError, future, apiError } = require('./harness');

const keyStatus = { resource: 'account', operation: 'getKeyStatus' };

function searchParams(extra = {}) {
	return {
		resource: 'hotel',
		operation: 'search',
		location: '29230',
		checkin: future(20),
		checkout: future(22),
		additionalFields: {},
		returnAll: false,
		splitIntoItems: true,
		...extra,
	};
}

describe('error mapping', () => {
	it('QUOTA_EXCEEDED fails at once and is never retried', async () => {
		const { calls, error, sleeps } = await runError({
			params: keyStatus,
			responses: [apiError(429, 'QUOTA_EXCEEDED', 'Monthly quota of 100 requests exhausted.')],
		});
		assert.equal(calls.length, 1);
		assert.deepEqual(sleeps, []);
		assert.equal(error.name, 'NodeApiError');
		assert.match(error.message, /^QUOTA_EXCEEDED: Monthly quota/);
		assert.match(error.description, /did not retry/);
	});

	it('RATE_LIMIT_EXCEEDED waits for Retry-After, then succeeds', async () => {
		const { calls, json, sleeps } = await run({
			params: keyStatus,
			responses: [
				{ ...apiError(429, 'RATE_LIMIT_EXCEEDED'), headers: { 'retry-after': '2' } },
				{ body: { ok: true } },
			],
		});
		assert.equal(calls.length, 2);
		assert.deepEqual(sleeps, [2000]);
		assert.deepEqual(json, [{ ok: true }]);
	});

	it('RATE_LIMIT_EXCEEDED gives up after 3 retries', async () => {
		const limited = { ...apiError(429, 'RATE_LIMIT_EXCEEDED'), headers: { 'retry-after': '1' } };
		const { calls, error, sleeps } = await runError({
			params: keyStatus,
			responses: [limited, limited, limited, limited, { body: {} }],
		});
		assert.equal(calls.length, 4);
		assert.deepEqual(sleeps, [1000, 1000, 1000]);
		assert.match(error.message, /^RATE_LIMIT_EXCEEDED/);
	});

	it('caps a huge Retry-After so a workflow cannot stall', async () => {
		const { sleeps } = await run({
			params: keyStatus,
			responses: [{ ...apiError(429, 'RATE_LIMIT_EXCEEDED'), headers: { 'retry-after': '86400' } }, { body: {} }],
		});
		assert.deepEqual(sleeps, [60000]);
	});

	for (const code of ['SEARCH_FAILED', 'DETAILS_FAILED', 'REVIEWS_UNAVAILABLE', 'UPSTREAM_ERROR']) {
		it(`502 ${code} retries once, then fails`, async () => {
			const { calls, error } = await runError({
				params: keyStatus,
				responses: [apiError(502, code), apiError(502, code), { body: {} }],
			});
			assert.equal(calls.length, 2);
			assert.match(error.message, new RegExp(`^${code}`));
		});
	}

	it('a 502 followed by success returns the result', async () => {
		const { calls, json } = await run({
			params: keyStatus,
			responses: [apiError(502, 'UPSTREAM_ERROR'), { body: { ok: 1 } }],
		});
		assert.equal(calls.length, 2);
		assert.deepEqual(json, [{ ok: 1 }]);
	});

	for (const code of ['MISSING_API_KEY', 'INVALID_API_KEY']) {
		it(`401 ${code} points to the credential`, async () => {
			const { calls, error } = await runError({ params: keyStatus, responses: [apiError(401, code)] });
			assert.equal(calls.length, 1);
			assert.match(error.description, /Ktemia API credential/);
		});
	}

	for (const [code, param] of [
		['MISSING_FIELD', 'departureDate'],
		['TRIP_CONFLICT', 'legs'],
		['TOO_FEW_LEGS', 'legs'],
		['INVALID_ORIGIN', 'origin'],
		['INVALID_LOCATION', 'location'],
		['LEGS_OUT_OF_ORDER', 'legs[1].date'],
	]) {
		it(`400 ${code} names the field`, async () => {
			const { calls, error } = await runError({ params: keyStatus, responses: [apiError(400, code, 'Bad input', param)] });
			assert.equal(calls.length, 1);
			assert.match(error.message, new RegExp(`^${code}: Bad input`));
			assert.ok(error.description.includes(`"${param}"`), error.description);
		});
	}

	it('400 INVALID_SEARCH_TOKEN explains where tokens come from', async () => {
		const { error } = await runError({ params: keyStatus, responses: [apiError(400, 'INVALID_SEARCH_TOKEN')] });
		assert.match(error.description, /searchToken or nextToken/);
	});

	it('410 SEARCH_EXPIRED says to run the search again', async () => {
		const { calls, error } = await runError({
			params: { resource: 'flight', operation: 'getDetails', searchToken: 'old', resultId: 'x' },
			responses: [apiError(410, 'SEARCH_EXPIRED', 'This search has expired.')],
		});
		assert.equal(calls.length, 1);
		assert.match(error.description, /60 minutes/);
		assert.match(error.description, /Run the search again/);
	});

	it('404 NO_RESULTS from a search is zero items with a note, not a failure', async () => {
		const { calls, json, hints } = await run({
			params: searchParams(),
			responses: [apiError(404, 'NO_RESULTS', 'No hotels matched.')],
		});
		assert.equal(calls.length, 1);
		assert.deepEqual(json, []);
		assert.equal(hints.length, 1);
		assert.match(hints[0].message, /No hotels matched/);
	});

	it('404 NO_MORE_RESULTS ends paging quietly', async () => {
		const { calls, json, hints } = await run({
			params: { resource: 'car', operation: 'getNextPage', nextToken: 'last', returnAll: false, splitIntoItems: true },
			responses: [apiError(404, 'NO_MORE_RESULTS')],
		});
		assert.equal(calls.length, 1);
		assert.deepEqual(json, []);
		assert.match(hints[0].message, /No more results/);
	});

	it('a non-JSON error body still becomes a readable error', async () => {
		const { error } = await runError({ params: keyStatus, responses: [{ status: 403, body: '<html>Forbidden</html>' }] });
		assert.match(error.message, /REQUEST_FAILED: Ktemia API returned HTTP 403/);
	});

	it('Continue On Fail outputs the error and code, and carries on with the next item', async () => {
		const { json, calls } = await run({
			params: [keyStatus, keyStatus],
			continueOnFail: true,
			responses: [apiError(429, 'QUOTA_EXCEEDED', 'Quota gone.'), { body: { ok: true } }],
		});
		assert.equal(calls.length, 2);
		assert.deepEqual(json[0], { error: 'QUOTA_EXCEEDED: Quota gone.', code: 'QUOTA_EXCEEDED' });
		assert.deepEqual(json[1], { ok: true });
	});

	it('Continue On Fail also covers input the node rejected', async () => {
		const { json, calls } = await run({
			params: searchParams({ checkin: '2020-01-01' }),
			continueOnFail: true,
		});
		assert.equal(calls.length, 0);
		assert.match(json[0].error, /checkin is in the past/);
	});
});
