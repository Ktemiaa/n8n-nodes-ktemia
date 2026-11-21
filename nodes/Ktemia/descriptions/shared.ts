import type { INodeProperties, INodePropertyOptions } from 'n8n-workflow';

export const COUNTRY_DESCRIPTION =
	'Two-letter market code (ISO 3166-1 alpha-2), for example US or GB. It picks the market and the currency prices come back in. There is no separate currency field. Leave it out for US and USD.';

export function countryField(): INodeProperties {
	return {
		displayName: 'Country',
		name: 'country',
		type: 'string',
		default: '',
		placeholder: 'US',
		description: COUNTRY_DESCRIPTION,
	};
}

export const sortOrderOptions: INodePropertyOptions[] = [
	{ name: 'Ascending', value: 'asc' },
	{ name: 'Descending', value: 'desc' },
];

/** Return All, Limit and Split Into Items for the operations that read result pages. */
export function pagingFields(resource: string, operations: string[]): INodeProperties[] {
	return [
		{
			displayName: 'Return All',
			name: 'returnAll',
			type: 'boolean',
			default: false,
			displayOptions: { show: { resource: [resource], operation: operations } },
			description: 'Whether to return all results or only up to a given limit',
		},
		{
			displayName: 'Limit',
			name: 'limit',
			type: 'number',
			default: 50,
			typeOptions: { minValue: 1 },
			displayOptions: { show: { resource: [resource], operation: operations, returnAll: [true] } },
			description: 'Max number of results to return',
		},
		{
			displayName:
				'Each page of results is one request against your monthly quota. Return All keeps reading pages until Limit is reached or there are none left.',
			name: 'pagingNotice',
			type: 'notice',
			default: '',
			displayOptions: { show: { resource: [resource], operation: operations, returnAll: [true] } },
		},
		{
			displayName: 'Split Into Items',
			name: 'splitIntoItems',
			type: 'boolean',
			default: true,
			displayOptions: { show: { resource: [resource], operation: operations } },
			description:
				'Whether to output one item per result. Each item carries the searchToken that Get Details needs. Turn it off to get whole pages, including availableFilters and totalResults.',
		},
	];
}

export function detailsFields(resource: string, resultLabel: string): INodeProperties[] {
	return [
		{
			displayName: 'Search Token',
			name: 'searchToken',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			displayOptions: { show: { resource: [resource], operation: ['getDetails'] } },
			description:
				'The searchToken of the page the result appeared on, from a Search or Get Next Page output. Tokens expire 60 minutes after the search starts.',
		},
		{
			displayName: 'Result ID',
			name: 'resultId',
			type: 'string',
			required: true,
			default: '',
			displayOptions: { show: { resource: [resource], operation: ['getDetails'] } },
			description: `The ID of the ${resultLabel}, from the ID field of a search result`,
		},
	];
}

export function nextPageFields(resource: string): INodeProperties[] {
	return [
		{
			displayName: 'Next Token',
			name: 'nextToken',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			displayOptions: { show: { resource: [resource], operation: ['getNextPage'] } },
			description:
				'The nextToken from a Search or Get Next Page output. When a page has no nextToken, there are no more pages.',
		},
	];
}
