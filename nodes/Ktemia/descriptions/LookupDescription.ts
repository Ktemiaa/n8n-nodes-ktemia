import type { INodeProperties } from 'n8n-workflow';
import { countryField } from './shared';

const show = { resource: ['lookup'] };

export const lookupOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show },
		options: [
			{
				name: 'Find Airline',
				value: 'findAirline',
				description: 'Find two-letter IATA airline codes by airline name',
				action: 'Find an airline',
			},
			{
				name: 'Find Airport or City',
				value: 'findAirport',
				description:
					'Find IATA airport and city codes for flight searches, such as LHR or LON for every London airport',
				action: 'Find an airport or city',
			},
			{
				name: 'Find Car Rental Location',
				value: 'findCarLocation',
				description: 'Find the location ID a car search needs for its pickup or drop-off',
				action: 'Find a car rental location',
			},
			{
				name: 'Find Hotel Location',
				value: 'findHotelLocation',
				description: 'Find the location ID a hotel search needs',
				action: 'Find a hotel location',
			},
		],
		default: 'findAirport',
	},
];

export const lookupFields: INodeProperties[] = [
	{
		displayName: 'Query',
		name: 'query',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'London',
		displayOptions: { show },
		description:
			'Place, airport, hotel, or airline name, or a code. Each match is one output item. Costs one request.',
	},
	{
		displayName: 'Location Type',
		name: 'locationType',
		type: 'options',
		default: 'city',
		displayOptions: { show: { resource: ['lookup'], operation: ['findCarLocation'] } },
		options: [
			{ name: 'Airport', value: 'airport' },
			{ name: 'All', value: 'all' },
			{ name: 'City', value: 'city' },
		],
		description: 'Narrow the matches to city centres or airports',
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show },
		options: [
			{ ...countryField(), description: 'Two-letter market code that biases the matches, for example GB. Leave it out for US.' },
			{
				displayName: 'Language',
				name: 'locale',
				type: 'string',
				default: 'en',
				description: 'Two-letter language code for the returned names, for example en or de',
			},
		],
	},
];
