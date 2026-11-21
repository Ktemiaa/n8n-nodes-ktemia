'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { run, future } = require('./harness');

function page(ids, nextToken) {
	return { body: { flights: ids.map((id) => ({ id })), hasMore: Boolean(nextToken), ...(nextToken ? { nextToken } : {}) } };
}

function search(extra) {
	return {
		resource: 'flight',
		operation: 'search',
		tripType: 'oneWay',
		origin: 'JFK',
		destination: 'LAX',
		departureDate: future(14),
		additionalFields: {},
		splitIntoItems: true,
		...extra,
	};
}

const started = { body: { searchToken: 'p1', expiresIn: 3600 } };

describe('paging', () => {
	it('without Return All, reads only the first page', async () => {
		const { calls, json } = await run({
			params: search({ returnAll: false }),
			responses: [started, page(['a', 'b'], 'p2')],
		});
		assert.equal(calls.length, 2);
		assert.deepEqual(json.map((item) => item.id), ['a', 'b']);
	});

	it('Return All follows nextToken until it is absent', async () => {
		const { calls, json } = await run({
			params: search({ returnAll: true, limit: 100 }),
			responses: [started, page(['a', 'b'], 'p2'), page(['c', 'd'], 'p3'), page(['e'])],
		});
		assert.deepEqual(
			calls.slice(1).map((call) => call.qs.token),
			['p1', 'p2', 'p3'],
		);
		assert.deepEqual(json.map((item) => item.id), ['a', 'b', 'c', 'd', 'e']);
		// Each result carries the token of the page it came from, for Get Details.
		assert.deepEqual(json.map((item) => item.searchToken), ['p1', 'p1', 'p2', 'p2', 'p3']);
	});

	it('Return All stops at Limit, without reading further pages, and trims to Limit', async () => {
		const { calls, json } = await run({
			params: search({ returnAll: true, limit: 3 }),
			responses: [started, page(['a', 'b'], 'p2'), page(['c', 'd'], 'p3'), page(['e'])],
		});
		assert.equal(calls.length, 3, 'search + 2 pages, the third page is never read');
		assert.deepEqual(json.map((item) => item.id), ['a', 'b', 'c']);
	});

	it('Return All treats NO_MORE_RESULTS as the end', async () => {
		const { calls, json } = await run({
			params: search({ returnAll: true, limit: 50 }),
			responses: [
				started,
				page(['a'], 'p2'),
				{ status: 404, body: { success: false, error: { code: 'NO_MORE_RESULTS', message: 'done' }, data: null } },
			],
		});
		assert.equal(calls.length, 3);
		assert.deepEqual(json.map((item) => item.id), ['a']);
	});

	it('with Split Into Items off, outputs one item per page with its token', async () => {
		const { json } = await run({
			params: search({ returnAll: true, limit: 50, splitIntoItems: false }),
			responses: [started, page(['a'], 'p2'), page(['b'])],
		});
		assert.equal(json.length, 2);
		assert.equal(json[0].searchToken, 'p1');
		assert.equal(json[0].nextToken, 'p2');
		assert.equal(json[1].searchToken, 'p2');
		assert.equal(json[1].nextToken, undefined);
	});
});
