import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	accountOperations,
	carFields,
	carOperations,
	flightFields,
	flightOperations,
	hotelFields,
	hotelOperations,
	lookupFields,
	lookupOperations,
} from './descriptions';
import {
	KtemiaApiError,
	ktemiaRequest,
	ktemiaRequestOrEmpty,
	requireText,
	toNodeError,
} from './GenericFunctions';
import {
	buildCarBody,
	buildFlightBody,
	buildHotelBody,
	buildLookupQuery,
	buildReviewQuery,
} from './RequestBuilders';

type Vertical = 'flight' | 'hotel' | 'car';

/** Path segment and the key holding the results array, per vertical. */
const VERTICALS: Record<Vertical, { path: string; resultsKey: string }> = {
	flight: { path: '/flights', resultsKey: 'flights' },
	hotel: { path: '/hotels', resultsKey: 'hotels' },
	car: { path: '/cars', resultsKey: 'cars' },
};

const LOOKUPS: Record<string, { path: string; resultsKey: string; withType?: boolean }> = {
	findAirport: { path: '/flights/airports', resultsKey: 'airports' },
	findAirline: { path: '/flights/airlines', resultsKey: 'airlines' },
	findHotelLocation: { path: '/hotels/locations', resultsKey: 'locations' },
	findCarLocation: { path: '/cars/locations', resultsKey: 'locations', withType: true },
};

interface Page {
	token: string;
	body: IDataObject;
}

function isVertical(resource: string): resource is Vertical {
	return resource === 'flight' || resource === 'hotel' || resource === 'car';
}

function resultsOf(page: IDataObject, key: string): IDataObject[] {
	const results = page[key];
	return Array.isArray(results) ? (results as IDataObject[]) : [];
}

function nextTokenOf(page: IDataObject): string | undefined {
	const token = page.nextToken;
	return typeof token === 'string' && token !== '' ? token : undefined;
}

/** Shows a note above the output. Older n8n versions lack hints, so it is optional. */
function hint(context: IExecuteFunctions, message: string): void {
	if (typeof context.addExecutionHints === 'function') {
		context.addExecutionHints({ message, type: 'info', location: 'outputPane' });
	}
}

export class Ktemia implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Ktemia',
		name: 'ktemia',
		icon: { light: 'file:ktemia.svg', dark: 'file:ktemia.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Search and compare flight, hotel, and rental car prices across 100+ providers. Ktemia does not book: results link to the provider.',
		defaults: { name: 'Ktemia' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'ktemiaApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Account', value: 'account' },
					{ name: 'Car', value: 'car' },
					{ name: 'Flight', value: 'flight' },
					{ name: 'Hotel', value: 'hotel' },
					{ name: 'Lookup', value: 'lookup' },
				],
				default: 'flight',
			},
			...lookupOperations,
			...lookupFields,
			...flightOperations,
			...flightFields,
			...hotelOperations,
			...hotelFields,
			...carOperations,
			...carFields,
			...accountOperations,
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		/** Reads one results page. NO_MORE_RESULTS means the search is used up, not a failure. */
		const readPage = async (vertical: Vertical, token: string): Promise<Page | undefined> => {
			const result = await ktemiaRequestOrEmpty.call(
				this,
				'GET',
				`${VERTICALS[vertical].path}/results`,
				{ qs: { token } },
				['NO_MORE_RESULTS'],
			);
			return 'body' in result ? { token, body: result.body } : undefined;
		};

		/** Reads the page at `token`, then keeps following nextToken when Return All is on. */
		const collectPages = async (vertical: Vertical, token: string, itemIndex: number): Promise<Page[]> => {
			const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
			const limit = returnAll ? (this.getNodeParameter('limit', itemIndex, 50) as number) : Infinity;
			const key = VERTICALS[vertical].resultsKey;

			const pages: Page[] = [];
			let count = 0;
			let next: string | undefined = token;
			while (next !== undefined) {
				const page = await readPage(vertical, next);
				if (!page) break;
				pages.push(page);
				count += resultsOf(page.body, key).length;
				if (!returnAll || count >= limit) break;
				next = nextTokenOf(page.body);
			}

			if (returnAll && count > limit) {
				let remaining = limit;
				for (const page of pages) {
					const results = resultsOf(page.body, key);
					page.body = { ...page.body, [key]: results.slice(0, Math.max(remaining, 0)) };
					remaining -= results.length;
				}
			}
			return pages;
		};

		const output = (pages: Page[], vertical: Vertical, itemIndex: number): void => {
			const split = this.getNodeParameter('splitIntoItems', itemIndex, true) as boolean;
			const key = VERTICALS[vertical].resultsKey;
			for (const page of pages) {
				// Get Details needs the token of the page a result appeared on.
				const tokens: IDataObject = { searchToken: page.token };
				const next = nextTokenOf(page.body);
				if (next) tokens.nextToken = next;

				if (split) {
					for (const result of resultsOf(page.body, key)) {
						returnData.push({ json: { ...result, ...tokens }, pairedItem: { item: itemIndex } });
					}
				} else {
					returnData.push({ json: { ...page.body, ...tokens }, pairedItem: { item: itemIndex } });
				}
			}
			if (pages.length === 0) hint(this, 'No more results for this search.');
		};

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;

				if (resource === 'account') {
					const body = await ktemiaRequest.call(this, 'GET', '/key');
					returnData.push({ json: body, pairedItem: { item: i } });
					continue;
				}

				if (resource === 'lookup') {
					const lookup = LOOKUPS[operation];
					const fields = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
					const type = lookup.withType ? this.getNodeParameter('locationType', i, 'city') : undefined;
					const qs = buildLookupQuery(this.getNodeParameter('query', i), fields, type);
					const body = await ktemiaRequest.call(this, 'GET', lookup.path, { qs });
					for (const match of resultsOf(body, lookup.resultsKey)) {
						returnData.push({ json: match, pairedItem: { item: i } });
					}
					continue;
				}

				if (resource === 'hotel' && operation === 'getReviews') {
					const fields = this.getNodeParameter('reviewFields', i, {}) as IDataObject;
					const qs = buildReviewQuery(this.getNodeParameter('hotelId', i), fields);
					const body = await ktemiaRequest.call(this, 'GET', '/hotels/reviews', { qs });
					if (this.getNodeParameter('splitIntoItems', i, true) as boolean) {
						for (const review of resultsOf(body, 'reviews')) {
							returnData.push({
								json: { ...review, hotelId: body.hotelId, page: body.page, hasMore: body.hasMore },
								pairedItem: { item: i },
							});
						}
					} else {
						returnData.push({ json: body, pairedItem: { item: i } });
					}
					continue;
				}

				if (!isVertical(resource)) {
					throw new NodeOperationError(this.getNode(), `Unknown resource: ${resource}`, { itemIndex: i });
				}
				const { path } = VERTICALS[resource];

				switch (operation) {
					case 'search': {
						const body = buildSearchBody(this, resource, i);
						const started = await ktemiaRequestOrEmpty.call(this, 'POST', `${path}/search`, { body }, [
							'NO_RESULTS',
						]);
						if ('empty' in started) {
							hint(this, `No results: ${started.empty.message}`);
							continue;
						}
						const searchToken = String(started.body.searchToken ?? '');
						output(await collectPages(resource, searchToken, i), resource, i);
						break;
					}
					case 'getNextPage': {
						const token = requireText(
							this.getNodeParameter('nextToken', i),
							'nextToken',
							'Use the nextToken from a Search or Get Next Page output.',
						);
						output(await collectPages(resource, token, i), resource, i);
						break;
					}
					case 'getDetails': {
						const qs = {
							token: requireText(
								this.getNodeParameter('searchToken', i),
								'searchToken',
								'Use the searchToken from a Search or Get Next Page output.',
							),
							resultId: requireText(
								this.getNodeParameter('resultId', i),
								'resultId',
								'Use the ID of a search result.',
							),
						};
						const body = await ktemiaRequest.call(this, 'GET', `${path}/details`, { qs });
						returnData.push({ json: body, pairedItem: { item: i } });
						break;
					}
					default:
						throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, {
							itemIndex: i,
						});
				}
			} catch (error) {
				const nodeError = toNodeError.call(this, error, i);
				if (this.continueOnFail()) {
					const json: IDataObject = { error: nodeError.message };
					if (error instanceof KtemiaApiError) json.code = error.code;
					returnData.push({ json, pairedItem: { item: i } });
					continue;
				}
				throw nodeError;
			}
		}

		return [returnData];
	}
}

function buildSearchBody(context: IExecuteFunctions, vertical: Vertical, i: number): IDataObject {
	const additionalFields = context.getNodeParameter('additionalFields', i, {}) as IDataObject;
	switch (vertical) {
		case 'flight': {
			const tripType = context.getNodeParameter('tripType', i) as string;
			if (tripType === 'multiCity') {
				return buildFlightBody({
					tripType,
					legs: context.getNodeParameter('legs', i, {}) as IDataObject,
					additionalFields,
				});
			}
			return buildFlightBody({
				tripType,
				origin: context.getNodeParameter('origin', i),
				destination: context.getNodeParameter('destination', i),
				departureDate: context.getNodeParameter('departureDate', i),
				returnDate: tripType === 'roundTrip' ? context.getNodeParameter('returnDate', i) : undefined,
				additionalFields,
			});
		}
		case 'hotel':
			return buildHotelBody({
				location: context.getNodeParameter('location', i),
				checkin: context.getNodeParameter('checkin', i),
				checkout: context.getNodeParameter('checkout', i),
				additionalFields,
			});
		case 'car':
			return buildCarBody({
				pickupLocation: context.getNodeParameter('pickupLocation', i),
				pickupDate: context.getNodeParameter('pickupDate', i),
				dropoffDate: context.getNodeParameter('dropoffDate', i),
				additionalFields,
			});
		default: {
			const unreachable: never = vertical;
			throw new NodeOperationError(context.getNode(), `Unknown resource: ${String(unreachable)}`, {
				itemIndex: i,
			});
		}
	}
}
