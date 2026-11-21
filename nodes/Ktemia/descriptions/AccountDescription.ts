import type { INodeProperties } from 'n8n-workflow';

export const accountOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['account'] } },
		options: [
			{
				name: 'Get Key Status',
				value: 'getKeyStatus',
				description:
					'Get the plan, rate limits, and requests left this month. Free: it never counts against the quota.',
				action: 'Get API key status',
			},
		],
		default: 'getKeyStatus',
	},
];
