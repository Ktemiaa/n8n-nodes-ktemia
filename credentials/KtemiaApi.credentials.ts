import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class KtemiaApi implements ICredentialType {
	name = 'ktemiaApi';

	displayName = 'Ktemia API';

	icon: Icon = { light: 'file:../nodes/Ktemia/ktemia.svg', dark: 'file:../nodes/Ktemia/ktemia.dark.svg' };

	documentationUrl = 'https://www.ktemia.com/docs/api/';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description:
				'Create a free key at https://app.ktemia.com/api-keys. The Free plan includes 100 requests a month.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-API-Key': '={{$credentials.apiKey}}',
			},
		},
	};

	// GET /key is the only unmetered endpoint, so testing the credential is free.
	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.ktemia.com',
			url: '/key',
			method: 'GET',
		},
	};
}
