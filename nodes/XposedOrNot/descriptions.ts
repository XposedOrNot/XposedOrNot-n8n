import type { INodeProperties } from 'n8n-workflow';

const resource: INodeProperties = {
	displayName: 'Resource',
	name: 'resource',
	type: 'options',
	noDataExpression: true,
	options: [
		{ name: 'Breach', value: 'breach' },
		{ name: 'Domain', value: 'domain' },
		{ name: 'Email', value: 'email' },
		{ name: 'xonPlus Domain', value: 'plusDomain' },
	],
	default: 'email',
};

const emailOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['email'] } },
	options: [
		{
			name: 'Check Breaches',
			value: 'checkBreaches',
			description: 'Check whether an email address appears in known breaches',
			action: 'Check an email for breaches',
		},
		{
			name: 'Get Analytics',
			value: 'getAnalytics',
			description: 'Get the breaches, risk score and exposed data types for an email address',
			action: 'Get breach analytics for an email',
		},
	],
	default: 'checkBreaches',
};

const breachOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['breach'] } },
	options: [
		{
			name: 'Get',
			value: 'get',
			description: 'Get the details of one breach',
			action: 'Get a breach',
		},
		{
			name: 'Get Many',
			value: 'getAll',
			description: 'Get the breaches in the XposedOrNot catalog',
			action: 'Get many breaches',
		},
	],
	default: 'getAll',
};

const domainOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['domain'] } },
	options: [
		{
			name: 'Get Breaches',
			value: 'getBreaches',
			description: 'Get the breached addresses on the domains verified for your Community key',
			action: 'Get breaches for verified domains',
		},
	],
	default: 'getBreaches',
};

const plusDomainOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['plusDomain'] } },
	options: [
		{
			name: 'Create',
			value: 'create',
			description: 'Submit a domain for validation',
			action: 'Create a domain',
		},
		{
			name: 'Get Exposures',
			value: 'getExposures',
			description: 'Get the breached addresses on one of your domains',
			action: 'Get exposures for a domain',
		},
		{
			name: 'Get Many',
			value: 'getAll',
			description: 'Get the domains on your account and their status',
			action: 'Get many domains',
		},
		{
			name: 'Get Quota',
			value: 'getQuota',
			description: 'Get how many domain slots are used and how many are left',
			action: 'Get the domain quota',
		},
		{
			name: 'Get Summary',
			value: 'getSummary',
			description: 'Get the breach summary for one of your domains',
			action: 'Get a summary for a domain',
		},
	],
	default: 'getSummary',
};

const email: INodeProperties = {
	displayName: 'Email',
	name: 'email',
	type: 'string',
	required: true,
	default: '',
	placeholder: 'e.g. nathan@example.com',
	description: 'The email address to check',
	displayOptions: { show: { resource: ['email'] } },
};

const breachId: INodeProperties = {
	displayName: 'Breach ID',
	name: 'breachId',
	type: 'string',
	required: true,
	default: '',
	placeholder: 'e.g. Adobe',
	description: "The ID of the breach, as returned by 'Get Many'",
	displayOptions: { show: { resource: ['breach'], operation: ['get'] } },
};

const plusDomain: INodeProperties = {
	displayName: 'Domain',
	name: 'domain',
	type: 'string',
	required: true,
	default: '',
	placeholder: 'e.g. example.com',
	description: 'The domain name, without a protocol or path',
	displayOptions: {
		show: { resource: ['plusDomain'], operation: ['create', 'getExposures', 'getSummary'] },
	},
};

const returnAllBreaches: INodeProperties = {
	displayName: 'Return All',
	name: 'returnAll',
	type: 'boolean',
	default: false,
	description: 'Whether to return all results or only up to a given limit',
	displayOptions: { show: { resource: ['breach'], operation: ['getAll'] } },
};

const limitBreaches: INodeProperties = {
	displayName: 'Limit',
	name: 'limit',
	type: 'number',
	typeOptions: { minValue: 1 },
	default: 50,
	description: 'Max number of results to return',
	displayOptions: { show: { resource: ['breach'], operation: ['getAll'], returnAll: [false] } },
};

const returnAllPlus: INodeProperties = {
	displayName: 'Return All',
	name: 'returnAll',
	type: 'boolean',
	default: false,
	description: 'Whether to return all results or only up to a given limit',
	displayOptions: { show: { resource: ['plusDomain'], operation: ['getAll', 'getExposures'] } },
};

const limitPlus: INodeProperties = {
	displayName: 'Limit',
	name: 'limit',
	type: 'number',
	typeOptions: { minValue: 1 },
	default: 50,
	description: 'Max number of results to return',
	displayOptions: {
		show: {
			resource: ['plusDomain'],
			operation: ['getAll', 'getExposures'],
			returnAll: [false],
		},
	},
};

const simplify: INodeProperties = {
	displayName: 'Simplify',
	name: 'simplify',
	type: 'boolean',
	default: true,
	description: 'Whether to return a simplified version of the response instead of the raw data',
	displayOptions: {
		show: {
			resource: ['breach', 'domain', 'email', 'plusDomain'],
			operation: ['get', 'getAll', 'getAnalytics', 'getBreaches', 'getExposures', 'getSummary'],
		},
	},
};

const returnAllDomain: INodeProperties = {
	displayName: 'Return All',
	name: 'returnAll',
	type: 'boolean',
	default: false,
	description: 'Whether to return all results or only up to a given limit',
	displayOptions: {
		show: { resource: ['domain'], operation: ['getBreaches'], simplify: [true] },
	},
};

const limitDomain: INodeProperties = {
	displayName: 'Limit',
	name: 'limit',
	type: 'number',
	typeOptions: { minValue: 1 },
	default: 50,
	description: 'Max number of results to return',
	displayOptions: {
		show: {
			resource: ['domain'],
			operation: ['getBreaches'],
			simplify: [true],
			returnAll: [false],
		},
	},
};

const breachFilters: INodeProperties = {
	displayName: 'Filters',
	name: 'filters',
	type: 'collection',
	placeholder: 'Add Filter',
	default: {},
	displayOptions: { show: { resource: ['breach'], operation: ['getAll'] } },
	options: [
		{
			displayName: 'Domain',
			name: 'domain',
			type: 'string',
			default: '',
			placeholder: 'e.g. adobe.com',
			description: 'Only return breaches of this domain',
		},
	],
};

const plusDomainFilters: INodeProperties = {
	displayName: 'Filters',
	name: 'filters',
	type: 'collection',
	placeholder: 'Add Filter',
	default: {},
	displayOptions: { show: { resource: ['plusDomain'], operation: ['getAll'] } },
	options: [
		{
			displayName: 'Domain',
			name: 'domain',
			type: 'string',
			default: '',
			placeholder: 'e.g. *.example.com',
			description: 'Only return this domain. Use * as a wildcard.',
		},
		{
			displayName: 'Processing Status',
			name: 'processingStatus',
			type: 'options',
			default: 'completed',
			description: 'Only return domains in this processing state',
			options: [
				{ name: 'Completed', value: 'completed' },
				{ name: 'Failed', value: 'failed' },
				{ name: 'Large Domain Approved', value: 'large_domain_approved' },
				{ name: 'Large Domain Rejected', value: 'large_domain_rejected' },
				{ name: 'Pending Approval', value: 'pending_approval' },
				{ name: 'Processing', value: 'processing' },
				{ name: 'Queued', value: 'queued' },
			],
		},
		{
			displayName: 'Validation Status',
			name: 'domainStatus',
			type: 'options',
			default: 'approved',
			description: 'Only return domains in this validation state',
			options: [
				{ name: 'Approved', value: 'approved' },
				{ name: 'Pending Approval', value: 'pending_approval' },
				{ name: 'Pending Validation', value: 'pending_validation' },
				{ name: 'Rejected', value: 'rejected' },
			],
		},
	],
};

const plusDomainOptions: INodeProperties = {
	displayName: 'Options',
	name: 'options',
	type: 'collection',
	placeholder: 'Add Option',
	default: {},
	displayOptions: {
		show: { resource: ['plusDomain'], operation: ['getExposures', 'getSummary'] },
	},
	options: [
		{
			displayName: 'Since',
			name: 'since',
			type: 'dateTime',
			default: '',
			description: 'Only include breaches added to XposedOrNot after this time',
		},
	],
};

export const nodeProperties: INodeProperties[] = [
	resource,
	breachOperations,
	domainOperations,
	emailOperations,
	plusDomainOperations,
	email,
	breachId,
	plusDomain,
	returnAllBreaches,
	limitBreaches,
	returnAllPlus,
	limitPlus,
	breachFilters,
	plusDomainFilters,
	simplify,
	returnAllDomain,
	limitDomain,
	plusDomainOptions,
];
