import type { INodeProperties } from 'n8n-workflow';
import { countryField, detailsFields, nextPageFields, pagingFields, sortOrderOptions } from './shared';

const show = { resource: ['flight'] };
const showSearch = { resource: ['flight'], operation: ['search'] };

export const flightOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show },
		options: [
			{
				name: 'Get Details',
				value: 'getDetails',
				description:
					'Get every seller price, booking link, and bag fee for one flight. Costs one request.',
				action: 'Get flight details',
			},
			{
				name: 'Get Next Page',
				value: 'getNextPage',
				description: 'Read more results of an earlier flight search. Costs one request per page.',
				action: 'Get the next page of flights',
			},
			{
				name: 'Search',
				value: 'search',
				description:
					'Compare flight prices across providers. Starts a search and reads the first page: two requests.',
				action: 'Search flights',
			},
		],
		default: 'search',
	},
];

const placeHint = 'IATA airport or city code, such as JFK or NYC. Use Lookup > Find Airport or City to get one';

export const flightFields: INodeProperties[] = [
	{
		displayName: 'Trip Type',
		name: 'tripType',
		type: 'options',
		default: 'oneWay',
		displayOptions: { show: showSearch },
		options: [
			{ name: 'Multi-City', value: 'multiCity', description: '2 to 6 flights in travel order' },
			{ name: 'One Way', value: 'oneWay' },
			{ name: 'Round Trip', value: 'roundTrip' },
		],
	},
	{
		displayName: 'Origin',
		name: 'origin',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'JFK',
		displayOptions: { show: { ...showSearch, tripType: ['oneWay', 'roundTrip'] } },
		description: `Where the trip starts. ${placeHint}.`,
	},
	{
		displayName: 'Destination',
		name: 'destination',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'LAX',
		displayOptions: { show: { ...showSearch, tripType: ['oneWay', 'roundTrip'] } },
		description: `Where the trip goes. ${placeHint}.`,
	},
	{
		displayName: 'Departure Date',
		name: 'departureDate',
		type: 'dateTime',
		required: true,
		default: '',
		displayOptions: { show: { ...showSearch, tripType: ['oneWay', 'roundTrip'] } },
		description: 'Outbound date. Cannot be in the past.',
	},
	{
		displayName: 'Return Date',
		name: 'returnDate',
		type: 'dateTime',
		required: true,
		default: '',
		displayOptions: { show: { ...showSearch, tripType: ['roundTrip'] } },
		description: 'Return date. Cannot be before the departure date.',
	},
	{
		displayName: 'Flights',
		name: 'legs',
		type: 'fixedCollection',
		placeholder: 'Add Flight',
		required: true,
		default: {},
		typeOptions: { multipleValues: true },
		displayOptions: { show: { ...showSearch, tripType: ['multiCity'] } },
		description: 'Each flight of the trip, in travel order. Add 2 to 6.',
		options: [
			{
				displayName: 'Flight',
				name: 'leg',
				values: [
					{
						displayName: 'Origin',
						name: 'origin',
						type: 'string',
						default: '',
						placeholder: 'JFK',
						description: placeHint,
					},
					{
						displayName: 'Destination',
						name: 'destination',
						type: 'string',
						default: '',
						placeholder: 'LHR',
						description: placeHint,
					},
					{
						displayName: 'Date',
						name: 'date',
						type: 'dateTime',
						default: '',
						description: 'Departure date of this flight. Cannot be earlier than the flight before it.',
					},
				],
			},
		],
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: showSearch },
		options: [
			{
				displayName: 'Adults',
				name: 'adults',
				type: 'number',
				default: 1,
				typeOptions: { minValue: 0, maxValue: 9 },
				description:
					'Travellers aged 12 and over, including seniors, students, and youths. All travellers together: 1 to 9.',
			},
			{
				displayName: 'Airline Codes',
				name: 'airlines',
				type: 'string',
				default: '',
				placeholder: 'B6, DL',
				description:
					'Comma-separated two-letter IATA airline codes to keep, up to 20. Use Lookup > Find Airline to get them.',
			},
			{
				displayName: 'Alliances',
				name: 'alliances',
				type: 'multiOptions',
				default: [],
				options: [
					{ name: 'Oneworld', value: 'oneworld' },
					{ name: 'SkyTeam', value: 'skyteam' },
					{ name: 'Star Alliance', value: 'starAlliance' },
				],
				description: 'Keep only itineraries flown by these alliances',
			},
			{
				displayName: 'Cabin',
				name: 'cabin',
				type: 'options',
				default: 'economy',
				options: [
					{ name: 'Business', value: 'business' },
					{ name: 'Economy', value: 'economy', description: 'Results can include every cabin' },
					{ name: 'First', value: 'first' },
					{ name: 'Premium Economy', value: 'premiumEconomy' },
				],
				description: 'Which cabin to search',
			},
			{
				displayName: 'Children',
				name: 'children',
				type: 'number',
				default: 0,
				typeOptions: { minValue: 0, maxValue: 9 },
				description: 'Travellers aged 2 to 11. Count an infant in their own seat here.',
			},
			countryField(),
			{
				displayName: 'Infants on Lap',
				name: 'infantsOnLap',
				type: 'number',
				default: 0,
				typeOptions: { minValue: 0, maxValue: 9 },
				description: "Under 2, on an adult's lap. Cannot be more than the number of adults.",
			},
			{
				displayName: 'Max Price',
				name: 'maxPrice',
				type: 'number',
				default: 1000,
				typeOptions: { minValue: 1 },
				description: "Highest per-person fare, as a whole number in the market's currency",
			},
			{
				displayName: 'Max Stops',
				name: 'maxStops',
				type: 'options',
				default: 0,
				options: [
					{ name: 'Nonstop Only', value: 0 },
					{ name: 'Up to One Stop', value: 1 },
					{ name: 'Up to Two Stops', value: 2 },
				],
				description: 'How many stops to allow. Leave it out to allow any number.',
			},
			{
				displayName: 'Sort By',
				name: 'sortBy',
				type: 'options',
				default: 'bestValue',
				options: [
					{ name: 'Arrival Time', value: 'arrival' },
					{ name: 'Best Value', value: 'bestValue' },
					{ name: 'Departure Time', value: 'departure' },
					{ name: 'Duration', value: 'duration' },
					{ name: 'Price', value: 'price' },
				],
			},
			{
				displayName: 'Sort Order',
				name: 'sortOrder',
				type: 'options',
				default: 'asc',
				options: sortOrderOptions,
			},
		],
	},
	...nextPageFields('flight'),
	...pagingFields('flight', ['search', 'getNextPage']),
	...detailsFields('flight', 'flight'),
];
