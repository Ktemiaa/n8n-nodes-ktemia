import type { INodeProperties, INodePropertyOptions } from 'n8n-workflow';
import { countryField, detailsFields, nextPageFields, pagingFields, sortOrderOptions } from './shared';

const show = { resource: ['car'] };
const showSearch = { resource: ['car'], operation: ['search'] };

/** The API takes HH:MM with minutes 00 or 30, so offer exactly those. */
const TIME_OPTIONS: INodePropertyOptions[] = Array.from({ length: 48 }, (_, index) => {
	const hours = String(Math.floor(index / 2)).padStart(2, '0');
	const time = `${hours}:${index % 2 === 0 ? '00' : '30'}`;
	return { name: time, value: time };
});

export const carOperations: INodeProperties[] = [
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
				description: 'Get every seller price and booking link for one rental car. Costs one request.',
				action: 'Get car rental details',
			},
			{
				name: 'Get Next Page',
				value: 'getNextPage',
				description: 'Read more results of an earlier car search. Costs one request per page.',
				action: 'Get the next page of rental cars',
			},
			{
				name: 'Search',
				value: 'search',
				description:
					'Compare rental car prices across agencies and sites. Starts a search and reads the first page: two requests.',
				action: 'Search rental cars',
			},
		],
		default: 'search',
	},
];

export const carFields: INodeProperties[] = [
	{
		displayName: 'Pickup Location ID',
		name: 'pickupLocation',
		type: 'string',
		required: true,
		default: '',
		placeholder: '22863',
		displayOptions: { show: showSearch },
		description: 'The locationId from Lookup > Find Car Rental Location. A place name is rejected.',
	},
	{
		displayName: 'Pickup Date',
		name: 'pickupDate',
		type: 'dateTime',
		required: true,
		default: '',
		displayOptions: { show: showSearch },
		description: 'Cannot be in the past',
	},
	{
		displayName: 'Drop-Off Date',
		name: 'dropoffDate',
		type: 'dateTime',
		required: true,
		default: '',
		displayOptions: { show: showSearch },
		description: 'Cannot be before the pickup date',
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
				displayName: 'Agencies',
				name: 'agencies',
				type: 'string',
				default: '',
				placeholder: 'hertz, avis',
				description:
					'Comma-separated rental company IDs from availableFilters.agency on an earlier results page, up to 10. Use the lowercase ID such as hertz.',
			},
			{
				displayName: 'Car Class',
				name: 'carClass',
				type: 'options',
				default: 'medium',
				options: [
					{ name: 'Convertible', value: 'convertible' },
					{ name: 'Large', value: 'large', description: 'Full-size cars' },
					{ name: 'Luxury', value: 'luxury' },
					{ name: 'Medium', value: 'medium', description: 'Intermediate cars' },
					{ name: 'Pickup', value: 'pickup', description: 'Pickup trucks' },
					{ name: 'Small', value: 'small', description: 'Mini and compact cars' },
					{ name: 'SUV', value: 'suv' },
					{ name: 'Van', value: 'van', description: 'Vans and people carriers' },
				],
				description: 'Keep only this vehicle class. Leave it out to allow any class.',
			},
			countryField(),
			{
				displayName: 'Driver Age',
				name: 'driverAge',
				type: 'number',
				default: 30,
				typeOptions: { minValue: 18, maxValue: 99 },
				description: 'Age of the driver, 18 to 99. Under 25 often costs extra.',
			},
			{
				displayName: 'Drop-Off Location ID',
				name: 'dropoffLocation',
				type: 'string',
				default: '',
				description: 'A locationId when the car goes back somewhere else. Leave it out for the same place.',
			},
			{
				displayName: 'Drop-Off Time',
				name: 'dropoffTime',
				type: 'options',
				default: '12:00',
				options: TIME_OPTIONS,
			},
			{
				displayName: 'Max Price',
				name: 'maxPrice',
				type: 'number',
				default: 500,
				typeOptions: { minValue: 1 },
				description: "Highest total rental price, as a whole number in the market's currency",
			},
			{
				displayName: 'Pickup Time',
				name: 'pickupTime',
				type: 'options',
				default: '12:00',
				options: TIME_OPTIONS,
			},
			{
				displayName: 'Price Mode',
				name: 'priceMode',
				type: 'options',
				default: 'total',
				options: [
					{ name: 'Per Day', value: 'perDay', description: 'Prices show the average daily rate' },
					{ name: 'Total', value: 'total', description: 'Prices show the rental total' },
				],
				description: 'What each price shows. Max Price always caps the total.',
			},
			{
				displayName: 'Providers',
				name: 'providers',
				type: 'string',
				default: '',
				placeholder: 'Expedia',
				description:
					'Comma-separated booking site IDs from availableFilters.bookingSites on an earlier results page, up to 10',
			},
			{
				displayName: 'Sort By',
				name: 'sortBy',
				type: 'options',
				default: 'bestValue',
				options: [
					{ name: 'Best Value', value: 'bestValue' },
					{ name: 'Distance', value: 'distance', description: 'From the city centre' },
					{ name: 'Price', value: 'price' },
					{ name: 'Rating', value: 'rating' },
				],
			},
			{
				displayName: 'Sort Order',
				name: 'sortOrder',
				type: 'options',
				default: 'asc',
				options: sortOrderOptions,
			},
			{
				displayName: 'Transmission',
				name: 'transmission',
				type: 'options',
				default: 'automatic',
				options: [
					{ name: 'Automatic', value: 'automatic' },
					{ name: 'Manual', value: 'manual' },
				],
				description: 'Keep only this gearbox. Leave it out to allow either.',
			},
		],
	},
	...nextPageFields('car'),
	...pagingFields('car', ['search', 'getNextPage']),
	...detailsFields('car', 'rental car'),
];
