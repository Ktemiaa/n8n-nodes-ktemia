/**
 * Turn node parameters into API request bodies and query strings.
 *
 * Pure functions, so tests can assert exactly what is sent. The API rejects
 * unknown fields, so only fields the user actually set are copied.
 */
import type { IDataObject } from 'n8n-workflow';
import { KtemiaValidationError, requireText, toDate, toList, toPlaceCode } from './GenericFunctions';

function isSet(value: unknown): boolean {
	if (value === undefined || value === null) return false;
	if (typeof value === 'string') return value.trim() !== '';
	if (Array.isArray(value)) return value.length > 0;
	return true;
}

function toCountry(value: unknown): string {
	const code = String(value).trim().toUpperCase();
	if (!/^[A-Z]{2}$/.test(code)) {
		throw new KtemiaValidationError('country', 'country must be a two-letter code such as US or GB');
	}
	return code;
}

function toInteger(value: unknown, param: string, min: number, max?: number): number {
	const number = Number(value);
	if (!Number.isInteger(number) || number < min || (max !== undefined && number > max)) {
		const range = max === undefined ? `${min} or more` : `${min} to ${max}`;
		throw new KtemiaValidationError(param, `${param} must be a whole number, ${range}`);
	}
	return number;
}

function listField(value: unknown, param: string, max: number): string[] {
	const list = toList(value);
	if (list.length > max) {
		throw new KtemiaValidationError(param, `${param} takes at most ${max} values, got ${list.length}`);
	}
	return list;
}

/** Copies the fields every search shares: sorting, price cap, market. */
function copyCommon(body: IDataObject, fields: IDataObject): void {
	if (isSet(fields.maxPrice)) body.maxPrice = toInteger(fields.maxPrice, 'maxPrice', 1);
	if (isSet(fields.sortBy)) body.sortBy = fields.sortBy;
	if (isSet(fields.sortOrder)) body.sortOrder = fields.sortOrder;
	if (isSet(fields.country)) body.country = toCountry(fields.country);
}

function daysBetween(from: string, to: string): number {
	return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

// ── Flights ──────────────────────────────────────────────────────────────────

export interface FlightParams {
	tripType: string;
	origin?: unknown;
	destination?: unknown;
	departureDate?: unknown;
	returnDate?: unknown;
	legs?: IDataObject;
	additionalFields: IDataObject;
}

export function buildFlightBody(params: FlightParams): IDataObject {
	const body: IDataObject = {};
	const fields = params.additionalFields;

	if (params.tripType === 'multiCity') {
		const rawLegs = (params.legs?.leg as IDataObject[] | undefined) ?? [];
		if (rawLegs.length < 2 || rawLegs.length > 6) {
			throw new KtemiaValidationError(
				'legs',
				`A multi-city trip needs 2 to 6 flights, got ${rawLegs.length}. For a single flight, use One Way.`,
			);
		}
		let previous = '';
		body.legs = rawLegs.map((leg, index) => {
			const origin = toPlaceCode(leg.origin, `legs[${index}].origin`);
			const destination = toPlaceCode(leg.destination, `legs[${index}].destination`);
			if (origin === destination) {
				throw new KtemiaValidationError(`legs[${index}].destination`, `Flight ${index + 1} starts and ends at ${origin}`);
			}
			const date = toDate(leg.date, `legs[${index}].date`);
			if (previous && date < previous) {
				throw new KtemiaValidationError(`legs[${index}].date`, `Flight ${index + 1} is dated before the flight before it`);
			}
			previous = date;
			return { origin, destination, date };
		});
	} else {
		body.origin = toPlaceCode(params.origin, 'origin');
		body.destination = toPlaceCode(params.destination, 'destination');
		if (body.origin === body.destination) {
			throw new KtemiaValidationError('destination', 'origin and destination must be different');
		}
		body.departureDate = toDate(params.departureDate, 'departureDate');
		if (params.tripType === 'roundTrip') {
			body.returnDate = toDate(params.returnDate, 'returnDate');
			if ((body.returnDate as string) < (body.departureDate as string)) {
				throw new KtemiaValidationError('returnDate', 'returnDate cannot be before departureDate');
			}
		}
	}

	if (isSet(fields.cabin)) body.cabin = fields.cabin;

	const passengers: IDataObject = {};
	for (const key of ['adults', 'children', 'infantsOnLap']) {
		if (isSet(fields[key])) passengers[key] = toInteger(fields[key], key, 0, 9);
	}
	if (Object.keys(passengers).length > 0) {
		const adults = (passengers.adults as number | undefined) ?? 1;
		const total = adults + ((passengers.children as number) ?? 0) + ((passengers.infantsOnLap as number) ?? 0);
		if (total < 1 || total > 9) {
			throw new KtemiaValidationError('passengers', `There must be 1 to 9 travellers in total, got ${total}`);
		}
		if (((passengers.infantsOnLap as number) ?? 0) > adults) {
			throw new KtemiaValidationError('infantsOnLap', 'There cannot be more lap infants than adults');
		}
		body.passengers = passengers;
	}

	if (isSet(fields.maxStops)) body.maxStops = toInteger(fields.maxStops, 'maxStops', 0, 2);
	if (isSet(fields.airlines)) {
		const airlines = listField(fields.airlines, 'airlines', 20).map((code) => code.toUpperCase());
		if (airlines.length > 0) body.airlines = airlines;
	}
	if (isSet(fields.alliances)) body.alliances = fields.alliances;
	copyCommon(body, fields);
	return body;
}

// ── Hotels ───────────────────────────────────────────────────────────────────

export interface HotelParams {
	location: unknown;
	checkin: unknown;
	checkout: unknown;
	additionalFields: IDataObject;
}

export function buildHotelBody(params: HotelParams): IDataObject {
	const fields = params.additionalFields;
	const body: IDataObject = {
		location: requireText(params.location, 'location', 'Use Lookup > Find Hotel Location to get a location ID.'),
		checkin: toDate(params.checkin, 'checkin'),
		checkout: toDate(params.checkout, 'checkout'),
	};
	const nights = daysBetween(body.checkin as string, body.checkout as string);
	if (nights < 1 || nights > 30) {
		throw new KtemiaValidationError('checkout', `checkout must be 1 to 30 nights after checkin, got ${nights}`);
	}

	if (isSet(fields.adults)) body.adults = toInteger(fields.adults, 'adults', 1, 16);
	if (isSet(fields.rooms)) body.rooms = toInteger(fields.rooms, 'rooms', 1, 8);
	if (isSet(fields.childAges)) {
		const ages = listField(fields.childAges, 'childAges', 8).map((age) => toInteger(age, 'childAges', 0, 17));
		if (ages.length > 0) body.childAges = ages;
	}
	if (isSet(fields.minStars)) body.minStars = toInteger(fields.minStars, 'minStars', 2, 5);
	if (isSet(fields.minRating)) body.minRating = toInteger(fields.minRating, 'minRating', 6, 9);
	if (isSet(fields.freeCancellation)) body.freeCancellation = fields.freeCancellation === true;
	if (isSet(fields.amenities)) {
		const amenities = listField(fields.amenities, 'amenities', 10);
		if (amenities.length > 0) body.amenities = amenities;
	}
	if (isSet(fields.providers)) {
		const providers = listField(fields.providers, 'providers', 10);
		if (providers.length > 0) body.providers = providers;
	}
	copyCommon(body, fields);
	return body;
}

export function buildReviewQuery(hotelId: unknown, fields: IDataObject): IDataObject {
	const qs: IDataObject = {
		hotelId: requireText(hotelId, 'hotelId', 'Use the hotel ID from a hotel search result.'),
	};
	if (isSet(fields.sortBy)) qs.sortBy = fields.sortBy;
	// The API reads a list as one comma-separated value.
	for (const key of ['travelerTypes', 'months', 'sources']) {
		if (isSet(fields[key])) qs[key] = toList(fields[key]).join(',');
	}
	if (isSet(fields.search)) qs.search = String(fields.search).trim();
	if (isSet(fields.page)) qs.page = toInteger(fields.page, 'page', 1, 1000);
	return qs;
}

// ── Cars ─────────────────────────────────────────────────────────────────────

export interface CarParams {
	pickupLocation: unknown;
	pickupDate: unknown;
	dropoffDate: unknown;
	additionalFields: IDataObject;
}

export function buildCarBody(params: CarParams): IDataObject {
	const fields = params.additionalFields;
	const body: IDataObject = {
		pickupLocation: requireText(
			params.pickupLocation,
			'pickupLocation',
			'Use Lookup > Find Car Rental Location to get a location ID.',
		),
		pickupDate: toDate(params.pickupDate, 'pickupDate'),
		dropoffDate: toDate(params.dropoffDate, 'dropoffDate'),
	};
	if ((body.dropoffDate as string) < (body.pickupDate as string)) {
		throw new KtemiaValidationError('dropoffDate', 'dropoffDate cannot be before pickupDate');
	}

	if (isSet(fields.dropoffLocation)) body.dropoffLocation = String(fields.dropoffLocation).trim();
	for (const key of ['pickupTime', 'dropoffTime']) {
		if (!isSet(fields[key])) continue;
		const time = String(fields[key]).trim();
		if (!/^([01]\d|2[0-3]):(00|30)$/.test(time)) {
			throw new KtemiaValidationError(key, `${key} must be HH:MM with minutes 00 or 30, such as 09:30`);
		}
		body[key] = time;
	}
	if (isSet(fields.driverAge)) body.driverAge = toInteger(fields.driverAge, 'driverAge', 18, 99);
	// A single class, not a list: the API takes exactly one value.
	if (isSet(fields.carClass)) body.carClass = String(fields.carClass);
	if (isSet(fields.transmission)) body.transmission = fields.transmission;
	if (isSet(fields.providers)) {
		const providers = listField(fields.providers, 'providers', 10);
		if (providers.length > 0) body.providers = providers;
	}
	if (isSet(fields.agencies)) {
		const agencies = listField(fields.agencies, 'agencies', 10);
		if (agencies.length > 0) body.agencies = agencies;
	}
	if (isSet(fields.priceMode)) body.priceMode = fields.priceMode;
	copyCommon(body, fields);
	return body;
}

// ── Lookups ──────────────────────────────────────────────────────────────────

export function buildLookupQuery(query: unknown, fields: IDataObject, locationType?: unknown): IDataObject {
	const text = requireText(query, 'query', 'Enter a place, airport, hotel, or airline name.');
	if (text.length > 80) throw new KtemiaValidationError('query', 'query can be at most 80 characters');
	const qs: IDataObject = { query: text };
	if (isSet(locationType)) qs.type = String(locationType);
	if (isSet(fields.country)) qs.country = toCountry(fields.country);
	if (isSet(fields.locale)) {
		const locale = String(fields.locale).trim().toLowerCase();
		if (!/^[a-z]{2}$/.test(locale)) {
			throw new KtemiaValidationError('locale', 'locale must be a two-letter language code such as en');
		}
		qs.locale = locale;
	}
	return qs;
}
