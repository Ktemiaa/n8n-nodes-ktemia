'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { run, runError, future } = require('./harness');

const BASE = 'https://api.ktemia.com';

function only(call) {
	return { method: call.method, url: call.url, qs: call.qs, body: call.body };
}

describe('every request', () => {
	it('authenticates with the ktemiaApi credential, refuses redirects, and parses JSON', async () => {
		const { calls } = await run({
			params: { resource: 'account', operation: 'getKeyStatus' },
			responses: [{ body: { plan: { name: 'free' } } }],
		});
		assert.equal(calls[0].credential, 'ktemiaApi');
		assert.equal(calls[0].disableFollowRedirect, true);
		assert.equal(calls[0].json, true);
		assert.equal(calls[0].returnFullResponse, true);
		assert.equal(calls[0].ignoreHttpStatusErrors, true);
	});
});

describe('Account', () => {
	it('Get Key Status reads GET /key and passes the response through', async () => {
		const status = { key: { fingerprint: 'abc' }, plan: { name: 'free', monthlyQuota: 100 }, metered: false };
		const { calls, json } = await run({
			params: { resource: 'account', operation: 'getKeyStatus' },
			responses: [{ body: status }],
		});
		assert.deepEqual(only(calls[0]), { method: 'GET', url: `${BASE}/key`, qs: undefined, body: undefined });
		assert.deepEqual(json, [status]);
	});
});

describe('Lookup', () => {
	const cases = [
		['findAirport', '/flights/airports', 'airports'],
		['findAirline', '/flights/airlines', 'airlines'],
		['findHotelLocation', '/hotels/locations', 'locations'],
	];
	for (const [operation, path, key] of cases) {
		it(`${operation} calls GET ${path} and outputs one item per match`, async () => {
			const { calls, json } = await run({
				params: { resource: 'lookup', operation, query: ' London ', additionalFields: {} },
				responses: [{ body: { query: 'london', [key]: [{ code: 'LON' }, { code: 'LHR' }] } }],
			});
			assert.deepEqual(only(calls[0]), { method: 'GET', url: `${BASE}${path}`, qs: { query: 'London' }, body: undefined });
			assert.deepEqual(json, [{ code: 'LON' }, { code: 'LHR' }]);
		});
	}

	it('findCarLocation sends type, and country and locale only when set', async () => {
		const { calls } = await run({
			params: {
				resource: 'lookup',
				operation: 'findCarLocation',
				query: 'Austin',
				locationType: 'airport',
				additionalFields: { country: 'us', locale: 'EN' },
			},
			responses: [{ body: { locations: [] } }],
		});
		assert.deepEqual(calls[0].qs, { query: 'Austin', type: 'airport', country: 'US', locale: 'en' });
	});

	it('does not send type for other lookups', async () => {
		const { calls } = await run({
			params: { resource: 'lookup', operation: 'findAirport', query: 'Paris', locationType: 'all', additionalFields: {} },
			responses: [{ body: { airports: [] } }],
		});
		assert.deepEqual(calls[0].qs, { query: 'Paris' });
	});
});

describe('Flight search', () => {
	const firstPage = {
		flights: [{ id: 'f1' }, { id: 'f2' }],
		page: 1,
		hasMore: true,
		nextToken: 'tok-2',
		totalResults: 40,
	};

	it('one way: posts only the set fields, then reads the first page with the searchToken', async () => {
		const date = future(20);
		const { calls, json } = await run({
			params: {
				resource: 'flight',
				operation: 'search',
				tripType: 'oneWay',
				origin: 'jfk',
				destination: 'LAX ',
				departureDate: `${date}T00:00:00`,
				additionalFields: {},
				returnAll: false,
				splitIntoItems: true,
			},
			responses: [{ body: { searchToken: 'tok-1', expiresIn: 3600 } }, { body: firstPage }],
		});
		assert.equal(calls.length, 2);
		assert.deepEqual(only(calls[0]), {
			method: 'POST',
			url: `${BASE}/flights/search`,
			qs: undefined,
			body: { origin: 'JFK', destination: 'LAX', departureDate: date },
		});
		assert.deepEqual(only(calls[1]), {
			method: 'GET',
			url: `${BASE}/flights/results`,
			qs: { token: 'tok-1' },
			body: undefined,
		});
		assert.deepEqual(json, [
			{ id: 'f1', searchToken: 'tok-1', nextToken: 'tok-2' },
			{ id: 'f2', searchToken: 'tok-1', nextToken: 'tok-2' },
		]);
	});

	it('round trip with every optional field maps to the API names', async () => {
		const out = future(30);
		const back = future(37);
		const { calls } = await run({
			params: {
				resource: 'flight',
				operation: 'search',
				tripType: 'roundTrip',
				origin: 'LON',
				destination: 'NYC',
				departureDate: out,
				returnDate: back,
				additionalFields: {
					cabin: 'business',
					adults: 2,
					children: 1,
					infantsOnLap: 1,
					maxStops: 0,
					airlines: 'ba, aa',
					alliances: ['oneworld'],
					maxPrice: 900,
					sortBy: 'price',
					sortOrder: 'desc',
					country: 'gb',
				},
				returnAll: false,
				splitIntoItems: false,
			},
			responses: [{ body: { searchToken: 't' } }, { body: { flights: [] } }],
		});
		assert.deepEqual(calls[0].body, {
			origin: 'LON',
			destination: 'NYC',
			departureDate: out,
			returnDate: back,
			cabin: 'business',
			passengers: { adults: 2, children: 1, infantsOnLap: 1 },
			maxStops: 0,
			airlines: ['BA', 'AA'],
			alliances: ['oneworld'],
			maxPrice: 900,
			sortBy: 'price',
			sortOrder: 'desc',
			country: 'GB',
		});
	});

	it('multi-city sends legs and none of the flat fields', async () => {
		const d1 = future(10);
		const d2 = future(15);
		const { calls } = await run({
			params: {
				resource: 'flight',
				operation: 'search',
				tripType: 'multiCity',
				// Leftover flat values from switching trip type must not leak into the body.
				origin: 'JFK',
				destination: 'LAX',
				departureDate: d1,
				legs: {
					leg: [
						{ origin: 'nyc', destination: 'lon', date: d1 },
						{ origin: 'LON', destination: 'PAR', date: d2 },
					],
				},
				additionalFields: {},
				returnAll: false,
				splitIntoItems: true,
			},
			responses: [{ body: { searchToken: 't' } }, { body: { flights: [] } }],
		});
		assert.deepEqual(calls[0].body, {
			legs: [
				{ origin: 'NYC', destination: 'LON', date: d1 },
				{ origin: 'LON', destination: 'PAR', date: d2 },
			],
		});
	});

	const invalid = [
		['a single multi-city leg', { tripType: 'multiCity', legs: { leg: [{ origin: 'JFK', destination: 'LAX', date: future(5) }] } }, 'legs'],
		['legs out of order', { tripType: 'multiCity', legs: { leg: [{ origin: 'JFK', destination: 'LAX', date: future(9) }, { origin: 'LAX', destination: 'SFO', date: future(5) }] } }, 'legs[1].date'],
		['a past departure date', { tripType: 'oneWay', origin: 'JFK', destination: 'LAX', departureDate: '2020-01-01' }, 'departureDate'],
		['a malformed date', { tripType: 'oneWay', origin: 'JFK', destination: 'LAX', departureDate: '03/12/2026' }, 'departureDate'],
		['a place name instead of a code', { tripType: 'oneWay', origin: 'New York', destination: 'LAX', departureDate: future(5) }, 'origin'],
		['the same origin and destination', { tripType: 'oneWay', origin: 'JFK', destination: 'jfk', departureDate: future(5) }, 'destination'],
		['a return before departure', { tripType: 'roundTrip', origin: 'JFK', destination: 'LAX', departureDate: future(9), returnDate: future(5) }, 'returnDate'],
		['more lap infants than adults', { tripType: 'oneWay', origin: 'JFK', destination: 'LAX', departureDate: future(5), additionalFields: { adults: 1, infantsOnLap: 2 } }, 'infantsOnLap'],
		['ten travellers', { tripType: 'oneWay', origin: 'JFK', destination: 'LAX', departureDate: future(5), additionalFields: { adults: 9, children: 1 } }, 'passengers'],
	];
	for (const [label, fields, param] of invalid) {
		it(`rejects ${label} without spending a request`, async () => {
			const { error, calls } = await runError({
				params: { resource: 'flight', operation: 'search', additionalFields: {}, ...fields },
			});
			assert.equal(calls.length, 0);
			assert.equal(error.name, 'NodeOperationError');
			assert.match(error.description, new RegExp(`"${param.replace(/[[\]]/g, '\\$&')}"`));
		});
	}
});

describe('Hotel', () => {
	it('search posts location and dates, and turns comma lists into arrays', async () => {
		const checkin = future(40);
		const checkout = future(43);
		const { calls } = await run({
			params: {
				resource: 'hotel',
				operation: 'search',
				location: ' 29230 ',
				checkin,
				checkout,
				additionalFields: {
					adults: 3,
					rooms: 2,
					childAges: '4, 9',
					minStars: 4,
					minRating: 8,
					freeCancellation: true,
					amenities: 'pool,wifi',
					providers: 'Booking.com',
					maxPrice: 300,
					sortBy: 'rating',
				},
				returnAll: false,
				splitIntoItems: true,
			},
			responses: [{ body: { searchToken: 'h1' } }, { body: { hotels: [{ id: 'x' }] } }],
		});
		assert.deepEqual(only(calls[0]), {
			method: 'POST',
			url: `${BASE}/hotels/search`,
			qs: undefined,
			body: {
				location: '29230',
				checkin,
				checkout,
				adults: 3,
				rooms: 2,
				childAges: [4, 9],
				minStars: 4,
				minRating: 8,
				freeCancellation: true,
				amenities: ['pool', 'wifi'],
				providers: ['Booking.com'],
				maxPrice: 300,
				sortBy: 'rating',
			},
		});
		assert.equal(calls[1].url, `${BASE}/hotels/results`);
	});

	it('rejects a zero-night stay and a stay over 30 nights', async () => {
		for (const nights of [0, 31]) {
			const { calls, error } = await runError({
				params: {
					resource: 'hotel',
					operation: 'search',
					location: '1',
					checkin: future(10),
					checkout: future(10 + nights),
					additionalFields: {},
				},
			});
			assert.equal(calls.length, 0);
			assert.match(error.message, /1 to 30 nights/);
		}
	});

	it('Get Details sends the token and result ID', async () => {
		// A real providerUrl is a Ktemia click link, resolved to the seller when
		// the traveller opens it. The node must hand it on untouched.
		const clickLink = 'https://api.ktemia.com/hotels/book?ref=eyJjIjoiVVMiLCJlIjoxNzk1fQ';
		const { calls, json } = await run({
			params: { resource: 'hotel', operation: 'getDetails', searchToken: 'tok', resultId: 'r9' },
			responses: [{ body: { resultId: 'r9', bookingOptions: [{ providerUrl: clickLink }] } }],
		});
		assert.deepEqual(only(calls[0]), {
			method: 'GET',
			url: `${BASE}/hotels/details`,
			qs: { token: 'tok', resultId: 'r9' },
			body: undefined,
		});
		// providerUrl is passed through exactly as the API gave it.
		assert.equal(json[0].bookingOptions[0].providerUrl, clickLink);
	});

	it('Get Reviews joins list filters with commas and splits reviews into items', async () => {
		const { calls, json } = await run({
			params: {
				resource: 'hotel',
				operation: 'getReviews',
				hotelId: '5782',
				splitIntoItems: true,
				reviewFields: {
					sortBy: 'lowestScore',
					travelerTypes: ['families', 'solo'],
					months: [6, 7, 8],
					sources: ['booking'],
					search: 'noise',
					page: 2,
				},
			},
			responses: [{ body: { hotelId: '5782', page: 2, hasMore: false, reviews: [{ id: 'a' }, { id: 'b' }] } }],
		});
		assert.deepEqual(calls[0].qs, {
			hotelId: '5782',
			sortBy: 'lowestScore',
			travelerTypes: 'families,solo',
			months: '6,7,8',
			sources: 'booking',
			search: 'noise',
			page: 2,
		});
		assert.deepEqual(json, [
			{ id: 'a', hotelId: '5782', page: 2, hasMore: false },
			{ id: 'b', hotelId: '5782', page: 2, hasMore: false },
		]);
	});
});

describe('Car', () => {
	it('search sends carClass as a single value, never a list', async () => {
		const pickup = future(12);
		const dropoff = future(15);
		const { calls } = await run({
			params: {
				resource: 'car',
				operation: 'search',
				pickupLocation: '22863',
				pickupDate: pickup,
				dropoffDate: dropoff,
				additionalFields: {
					dropoffLocation: '34419',
					pickupTime: '09:30',
					dropoffTime: '18:00',
					driverAge: 24,
					carClass: 'suv',
					transmission: 'manual',
					agencies: 'hertz, avis',
					providers: 'Expedia',
					priceMode: 'perDay',
					sortBy: 'price',
				},
				returnAll: false,
				splitIntoItems: true,
			},
			responses: [{ body: { searchToken: 'c1' } }, { body: { cars: [] } }],
		});
		assert.deepEqual(calls[0].body, {
			pickupLocation: '22863',
			pickupDate: pickup,
			dropoffDate: dropoff,
			dropoffLocation: '34419',
			pickupTime: '09:30',
			dropoffTime: '18:00',
			driverAge: 24,
			carClass: 'suv',
			transmission: 'manual',
			providers: ['Expedia'],
			agencies: ['hertz', 'avis'],
			priceMode: 'perDay',
			sortBy: 'price',
		});
		assert.equal(typeof calls[0].body.carClass, 'string');
		assert.equal(calls[1].url, `${BASE}/cars/results`);
	});

	it('rejects a drop-off before pickup and a time off the half hour', async () => {
		const cases = [
			[{ pickupDate: future(10), dropoffDate: future(9) }, /dropoffDate cannot be before/],
			[{ pickupDate: future(10), dropoffDate: future(11), additionalFields: { pickupTime: '09:15' } }, /minutes 00 or 30/],
		];
		for (const [fields, message] of cases) {
			const { calls, error } = await runError({
				params: { resource: 'car', operation: 'search', pickupLocation: '1', additionalFields: {}, ...fields },
			});
			assert.equal(calls.length, 0);
			assert.match(error.message, message);
		}
	});

	it('Get Details reads /cars/details', async () => {
		const { calls } = await run({
			params: { resource: 'car', operation: 'getDetails', searchToken: 't', resultId: 'c' },
			responses: [{ body: {} }],
		});
		assert.equal(calls[0].url, `${BASE}/cars/details`);
	});
});

describe('Flight details and next page', () => {
	it('Get Details reads /flights/details', async () => {
		const { calls } = await run({
			params: { resource: 'flight', operation: 'getDetails', searchToken: 't', resultId: 'f' },
			responses: [{ body: {} }],
		});
		assert.deepEqual(calls[0].qs, { token: 't', resultId: 'f' });
		assert.equal(calls[0].url, `${BASE}/flights/details`);
	});

	it('Get Next Page reads one page with the given token', async () => {
		const { calls, json } = await run({
			params: { resource: 'flight', operation: 'getNextPage', nextToken: 'tok-2', returnAll: false, splitIntoItems: false },
			responses: [{ body: { flights: [{ id: 'z' }], page: 2, nextToken: 'tok-3' } }],
		});
		assert.equal(calls.length, 1);
		assert.deepEqual(calls[0].qs, { token: 'tok-2' });
		assert.deepEqual(json, [{ flights: [{ id: 'z' }], page: 2, nextToken: 'tok-3', searchToken: 'tok-2' }]);
	});
});
