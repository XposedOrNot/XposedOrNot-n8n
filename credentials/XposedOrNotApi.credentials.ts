import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class XposedOrNotApi implements ICredentialType {
	name = 'xposedOrNotApi';

	displayName = 'XposedOrNot API';

	icon = {
		light: 'file:../nodes/XposedOrNot/xposedornot.svg',
		dark: 'file:../nodes/XposedOrNot/xposedornot.svg',
	} as const;

	documentationUrl = 'https://github.com/XposedOrNot/XposedOrNot-n8n#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'Key Type',
			name: 'keyType',
			type: 'options',
			options: [
				{
					name: 'Community',
					value: 'community',
					description: 'A free key from xposedornot.com',
				},
				{
					name: 'xonPlus',
					value: 'xonPlus',
					description: 'A key from your xonPlus account',
				},
			],
			default: 'community',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'x-api-key': '={{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL:
				'={{$credentials.keyType === "xonPlus" ? "https://plus-api.xposedornot.com" : "https://api.xposedornot.com"}}',
			url: '={{$credentials.keyType === "xonPlus" ? "/v2/partner/quota" : "/v1/domain-breaches/"}}',
			method: '={{$credentials.keyType === "xonPlus" ? "GET" : "POST"}}' as 'GET',
		},
	};
}
