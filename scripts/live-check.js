'use strict';

/**
 * Live end-to-end check against https://api.ktemia.com with a real key.
 *
 *   KTEMIA_API_KEY=... npm run build && node scripts/live-check.js
 *
 * Runs the built node with n8n's HTTP helper replaced by fetch, so it proves
 * the request shapes against the real API without starting n8n. About 15
 * requests; Get Key Status is free. Keep it that small: the Free plan has 100
 * requests a month.
 */
const { Ktemia } = require('../dist/nodes/Ktemia/Ktemia.node.js');

const KEY = process.env.KTEMIA_API_KEY;
if (!KEY) {
	console.error('Set KTEMIA_API_KEY');
	process.exit(2);
}

let requests = 0;

async function httpRequestWithAuthentication(credential, options) {
	if (credential !== 'ktemiaApi') throw new Error(`unexpected credential ${credential}`);
	const url = new URL(options.url);
	for (const [key, value] of Object.entries(options.qs || {})) url.searchParams.set(key, String(value));
	requests++;
	const response = await fetch(url, {
		method: options.method,
		redirect: options.disableFollowRedirect ? 'manual' : 'follow',
		headers: {
			...options.headers,
			'X-API-Key': KEY,
			...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
		},
		body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
	});
	const text = await response.text();
	let body = text;
	try {
		body = JSON.parse(text);
	} catch {
		// keep the raw text
	}
	return { statusCode: response.status, headers: Object.fromEntries(response.headers), body };
}

async function node(params) {
	const hints = [];
	const context = {
		getInputData: () => [{ json: {} }],
		getNodeParameter: (name, _i, fallback) => (name in params ? params[name] : fallback),
		getNode: () => ({ id: 'live', name: 'Ktemia', type: 'n8n-nodes-ktemia.ktemia', typeVersion: 1, position: [0, 0], parameters: {} }),
		continueOnFail: () => false,
		addExecutionHints: (...added) => hints.push(...added),
		helpers: { httpRequestWithAuthentication },
	};
	const [output] = await new Ktemia().execute.call(context);
	return { items: output.map((item) => item.json), hints };
}

function future(days) {
	const date = new Date();
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

const results = [];
async function step(name, fn) {
	const before = requests;
	try {
		const detail = await fn();
		results.push({ step: name, ok: true, requests: requests - before, detail });
	} catch (error) {
		results.push({ step: name, ok: false, requests: requests - before, detail: `${error.message} | ${error.description || ''}` });
	}
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

(async () => {
	await step('Account > Get Key Status', async () => {
		const { items } = await node({ resource: 'account', operation: 'getKeyStatus' });
		assert(items[0].plan && items[0].usage, 'no plan/usage');
		return `plan ${items[0].plan.name}`;
	});

	let airport;
	await step('Lookup > Find Airport', async () => {
		const { items } = await node({ resource: 'lookup', operation: 'findAirport', query: 'Austin', additionalFields: {} });
		airport = items.find((item) => item.code === 'AUS');
		assert(airport, 'AUS not found');
		return `${items.length} matches, AUS found`;
	});

	await step('Lookup > Find Airline', async () => {
		const { items } = await node({ resource: 'lookup', operation: 'findAirline', query: 'Delta', additionalFields: {} });
		assert(items.some((item) => item.code === 'DL'), 'DL not found');
		return `${items.length} matches, DL found`;
	});

	let flight;
	await step('Flight > Search (one way, nonstop, sorted by price)', async () => {
		const { items } = await node({
			resource: 'flight',
			operation: 'search',
			tripType: 'oneWay',
			origin: 'JFK',
			destination: 'LAX',
			departureDate: future(21),
			additionalFields: { maxStops: 0, sortBy: 'price', adults: 1 },
			returnAll: false,
			splitIntoItems: true,
		});
		assert(items.length > 0, 'no flights');
		flight = items[0];
		assert(flight.searchToken && flight.id, 'missing searchToken or id');
		return `${items.length} flights, cheapest ${flight.bookingOptions?.[0]?.formattedPrice}`;
	});

	await step('Flight > Get Next Page', async () => {
		assert(flight && flight.nextToken, 'no nextToken from search');
		const { items } = await node({
			resource: 'flight',
			operation: 'getNextPage',
			nextToken: flight.nextToken,
			returnAll: false,
			splitIntoItems: true,
		});
		return `${items.length} flights on page 2`;
	});

	await step('Flight > Get Details', async () => {
		const { items } = await node({ resource: 'flight', operation: 'getDetails', searchToken: flight.searchToken, resultId: flight.id });
		const option = items[0].bookingOptions?.[0];
		assert(option && option.providerUrl, 'no providerUrl');
		// The link has to be ours: it is resolved to the seller on the click,
		// so a seller address here means details went back to fetching every
		// option up front.
		assert(
			option.providerUrl.startsWith('https://api.ktemia.com/flights/book?ref='),
			`providerUrl is not a Ktemia click link: ${option.providerUrl}`,
		);
		return `${items[0].bookingOptions.length} booking options`;
	});

	let hotelLocation;
	await step('Lookup > Find Hotel Location', async () => {
		const { items } = await node({ resource: 'lookup', operation: 'findHotelLocation', query: 'Lisbon', additionalFields: {} });
		hotelLocation = items[0];
		assert(hotelLocation && hotelLocation.locationId, 'no locationId');
		return `${items.length} matches, first ${hotelLocation.name}`;
	});

	let hotel;
	await step('Hotel > Search (country GB, 8+ rating)', async () => {
		const { items } = await node({
			resource: 'hotel',
			operation: 'search',
			location: hotelLocation.locationId,
			checkin: future(30),
			checkout: future(33),
			additionalFields: { minRating: 8, country: 'GB' },
			returnAll: false,
			splitIntoItems: true,
		});
		assert(items.length > 0, 'no hotels');
		hotel = items[0];
		return `${items.length} hotels, first ${hotel.name}`;
	});

	await step('Hotel > Get Details', async () => {
		const { items } = await node({ resource: 'hotel', operation: 'getDetails', searchToken: hotel.searchToken, resultId: hotel.id });
		assert(Array.isArray(items[0].bookingOptions), 'no bookingOptions');
		return `${items[0].bookingOptions.length} booking options`;
	});

	await step('Hotel > Get Reviews (families, summer)', async () => {
		const { items } = await node({
			resource: 'hotel',
			operation: 'getReviews',
			hotelId: hotel.id,
			splitIntoItems: true,
			reviewFields: { travelerTypes: ['families', 'couples'], months: [6, 7, 8], sortBy: 'recent' },
		});
		return `${items.length} reviews`;
	});

	let carLocation;
	await step('Lookup > Find Car Rental Location (airport)', async () => {
		const { items } = await node({
			resource: 'lookup',
			operation: 'findCarLocation',
			query: 'AUS',
			locationType: 'airport',
			additionalFields: {},
		});
		carLocation = items[0];
		assert(carLocation && carLocation.locationId, 'no locationId');
		return `${items.length} matches, first ${carLocation.name}`;
	});

	let car;
	await step('Car > Search (SUV, 09:30 pickup)', async () => {
		const { items } = await node({
			resource: 'car',
			operation: 'search',
			pickupLocation: carLocation.locationId,
			pickupDate: future(25),
			dropoffDate: future(28),
			additionalFields: { carClass: 'suv', pickupTime: '09:30' },
			returnAll: false,
			splitIntoItems: true,
		});
		assert(items.length > 0, 'no cars');
		car = items[0];
		return `${items.length} cars, first ${car.car?.name}`;
	});

	await step('Car > Get Details', async () => {
		const { items } = await node({ resource: 'car', operation: 'getDetails', searchToken: car.searchToken, resultId: car.id });
		assert(Array.isArray(items[0].bookingOptions), 'no bookingOptions');
		return `${items[0].bookingOptions.length} booking options`;
	});

	await step('Unknown airport code QQQ: report how the API answers', async () => {
		try {
			const { items, hints } = await node({
				resource: 'flight',
				operation: 'search',
				tripType: 'oneWay',
				origin: 'QQQ',
				destination: 'LAX',
				departureDate: future(21),
				additionalFields: {},
				returnAll: false,
				splitIntoItems: true,
			});
			return `no error: ${items.length} items, hints: ${hints.map((hint) => hint.message).join('; ') || 'none'}`;
		} catch (error) {
			return `${error.message} | ${error.description}`;
		}
	});

	await step('Input mistakes fail before any request', async () => {
		try {
			await node({ resource: 'hotel', operation: 'search', location: '1', checkin: '2020-01-01', checkout: '2020-01-03', additionalFields: {} });
		} catch (error) {
			assert(/in the past/.test(error.message), error.message);
			return error.message;
		}
		throw new Error('expected a validation error');
	});

	for (const result of results) {
		console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.step}  [${result.requests} req]  ${result.detail}`);
	}
	console.log(`\n${requests} requests in total`);
	process.exit(results.every((result) => result.ok) ? 0 : 1);
})();
