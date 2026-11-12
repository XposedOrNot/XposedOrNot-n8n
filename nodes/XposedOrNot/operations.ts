import type { IDataObject, IExecuteFunctions, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import { fetchExposures, listDomains } from './partner';
import { apiRequest, extractDetail, getKeyType, requireKeyType } from './transport';

const EMAIL_PATTERN = /^[^\s@/?#]+@[^\s@/?#]+\.[^\s@/?#]+$/;
const DOMAIN_PATTERN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

const BREACH_SIMPLE_FIELDS = [
	'breachID',
	'breachedDate',
	'addedDate',
	'domain',
	'industry',
	'exposedRecords',
	'exposedData',
	'passwordRisk',
	'verified',
	'referenceURL',
];

const DOMAIN_ENTRY_SIMPLE_FIELDS = [
	'domain',
	'status',
	'processing_status',
	'record_count',
	'record_count_at',
	'submitted_at',
	'verified_at',
	'source',
	'entry_id',
];

const SUMMARY_SIMPLE_FIELDS = [
	'domain',
	'breach_count',
	'since',
	'as_of',
	'yearly_metrics',
	'domain_summary',
	'breach_summary',
	'top10_breaches',
];

function pick(source: IDataObject, fields: string[]): IDataObject {
	const result: IDataObject = {};
	for (const field of fields) {
		if (source[field] !== undefined) {
			result[field] = source[field];
		}
	}
	return result;
}

function readEmail(context: IExecuteFunctions, itemIndex: number): string {
	const email = String(context.getNodeParameter('email', itemIndex, '')).trim();
	if (!EMAIL_PATTERN.test(email)) {
		throw new NodeOperationError(context.getNode(), `'${email}' is not a valid email address`, {
			description: "Enter one full address in 'Email', for example nathan@example.com.",
			itemIndex,
		});
	}
	return email;
}

function readDomain(context: IExecuteFunctions, itemIndex: number): string {
	const domain = String(context.getNodeParameter('domain', itemIndex, ''))
		.trim()
		.toLowerCase();
	if (!DOMAIN_PATTERN.test(domain)) {
		throw new NodeOperationError(context.getNode(), `'${domain}' is not a valid domain name`, {
			description: "Enter a bare domain in 'Domain', for example example.com.",
			itemIndex,
		});
	}
	return domain;
}

function readLimit(context: IExecuteFunctions, itemIndex: number): number | undefined {
	if (context.getNodeParameter('returnAll', itemIndex, false) === true) {
		return undefined;
	}
	return Number(context.getNodeParameter('limit', itemIndex, 50));
}

function breachNames(breaches: unknown): string[] {
	if (!Array.isArray(breaches)) {
		return [];
	}
	const names: string[] = [];
	for (const entry of breaches.flat()) {
		if (typeof entry === 'string' && entry !== '') {
			names.push(entry);
		} else if (entry !== null && typeof entry === 'object') {
			const id = (entry as IDataObject).breach_id ?? (entry as IDataObject).breach;
			if (typeof id === 'string' && id !== '') {
				names.push(id);
			}
		}
	}
	return names;
}

function emailResult(email: string, breaches: string[]): IDataObject {
	return {
		email,
		breached: breaches.length > 0,
		breaches,
		breach_count: breaches.length,
	};
}

async function emailCheckBreaches(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject[]> {
	const email = readEmail(this, itemIndex);
	const usePlus = (await getKeyType.call(this)) === 'xonPlus';
	const { statusCode, body } = await apiRequest.call(this, {
		host: usePlus ? 'xonPlus' : 'community',
		method: 'GET',
		path: `${usePlus ? '/v3' : '/v1'}/check-email/${encodeURIComponent(email)}`,
		authenticated: usePlus,
		acceptStatuses: [404],
		itemIndex,
	});

	const names = breachNames(body.breaches);
	if (statusCode === 404 || names.length > 0 || Array.isArray(body.breaches)) {
		return [emailResult(email, names)];
	}

	const detail = extractDetail(body);
	if (detail === undefined || /not found/i.test(detail)) {
		return [emailResult(email, [])];
	}
	throw new NodeApiError(this.getNode(), body as JsonObject, {
		message: 'XposedOrNot could not check this email address',
		description: detail,
		itemIndex,
	});
}

function firstObject(value: unknown): IDataObject {
	const entry = Array.isArray(value) ? value[0] : value;
	return entry !== null && typeof entry === 'object' && !Array.isArray(entry)
		? (entry as IDataObject)
		: {};
}

function simplifyAnalytics(email: string, body: IDataObject): IDataObject {
	const metrics = firstObject(body.BreachMetrics);
	const details = firstObject(body.ExposedBreaches).breaches_details;
	let names = breachNames(details);
	if (names.length === 0) {
		const sites = firstObject(body.BreachesSummary).site;
		names = typeof sites === 'string' ? sites.split(';').filter((site) => site !== '') : [];
	}

	const risk = firstObject(metrics.risk);
	const byYear: IDataObject = {};
	for (const [key, count] of Object.entries(firstObject(metrics.yearwise_details))) {
		if (typeof count === 'number' && count > 0) {
			byYear[key.replace(/^y/, '')] = count;
		}
	}
	const pasteCount = Number(firstObject(body.PastesSummary).cnt ?? 0);

	return {
		...emailResult(email, names),
		risk_label: risk.risk_label ?? null,
		risk_score: risk.risk_score ?? null,
		password_strength: firstObject(metrics.passwords_strength),
		breaches_by_year: byYear,
		paste_count: Number.isFinite(pasteCount) ? pasteCount : 0,
	};
}

async function emailGetAnalytics(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject[]> {
	const email = readEmail(this, itemIndex);
	const simplify = this.getNodeParameter('simplify', itemIndex, true) === true;
	const { body } = await apiRequest.call(this, {
		host: 'community',
		method: 'GET',
		path: '/v1/breach-analytics',
		qs: { email },
		acceptStatuses: [404],
		itemIndex,
	});
	return [simplify ? simplifyAnalytics(email, body) : body];
}

async function fetchBreaches(
	this: IExecuteFunctions,
	qs: IDataObject,
	itemIndex: number,
): Promise<IDataObject[]> {
	const { body } = await apiRequest.call(this, {
		host: 'community',
		method: 'GET',
		path: '/v1/breaches',
		qs,
		acceptStatuses: [404],
		itemIndex,
	});
	return Array.isArray(body.exposedBreaches) ? (body.exposedBreaches as IDataObject[]) : [];
}

async function breachGet(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject[]> {
	const breachId = String(this.getNodeParameter('breachId', itemIndex, '')).trim();
	if (breachId === '') {
		throw new NodeOperationError(this.getNode(), "'Breach ID' is empty", {
			description: "Enter a breach ID, for example Adobe. Use 'Get Many' to see every ID.",
			itemIndex,
		});
	}
	const simplify = this.getNodeParameter('simplify', itemIndex, true) === true;
	const breaches = await fetchBreaches.call(this, { breach_id: breachId }, itemIndex);
	if (breaches.length === 0) {
		throw new NodeApiError(
			this.getNode(),
			{ breachId },
			{
				message: `No breach has the ID '${breachId}'`,
				description: "Check 'Breach ID'. Use 'Get Many' to see every ID.",
				httpCode: '404',
				itemIndex,
			},
		);
	}
	return [simplify ? pick(breaches[0], BREACH_SIMPLE_FIELDS) : breaches[0]];
}

async function breachGetAll(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject[]> {
	const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
	const simplify = this.getNodeParameter('simplify', itemIndex, true) === true;
	const limit = readLimit(this, itemIndex);
	const qs: IDataObject = {};
	const domain = typeof filters.domain === 'string' ? filters.domain.trim() : '';
	if (domain !== '') {
		qs.domain = domain;
	}
	const breaches = await fetchBreaches.call(this, qs, itemIndex);
	const selected = limit === undefined ? breaches : breaches.slice(0, limit);
	return simplify ? selected.map((breach) => pick(breach, BREACH_SIMPLE_FIELDS)) : selected;
}

async function domainGetBreaches(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject[]> {
	await requireKeyType.call(this, 'community', itemIndex);
	const simplify = this.getNodeParameter('simplify', itemIndex, true) === true;
	const { body } = await apiRequest.call(this, {
		host: 'community',
		method: 'POST',
		path: '/v1/domain-breaches/',
		authenticated: true,
		itemIndex,
	});
	if (!simplify) {
		return [body];
	}
	const limit = readLimit(this, itemIndex);
	const details = firstObject(body.metrics).Breaches_Details;
	const rows = Array.isArray(details) ? (details as IDataObject[]) : [];
	return limit === undefined ? rows : rows.slice(0, limit);
}

async function plusDomainGetSummary(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject[]> {
	await requireKeyType.call(this, 'xonPlus', itemIndex);
	const domain = readDomain(this, itemIndex);
	const simplify = this.getNodeParameter('simplify', itemIndex, true) === true;
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
	const qs: IDataObject = { domain };
	if (typeof options.since === 'string' && options.since !== '') {
		qs.since = options.since;
	}
	const { body } = await apiRequest.call(this, {
		host: 'xonPlus',
		method: 'GET',
		path: '/v2/partner/domain-summary',
		qs,
		authenticated: true,
		itemIndex,
	});
	return [simplify ? pick(body, SUMMARY_SIMPLE_FIELDS) : body];
}

async function plusDomainGetExposures(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject[]> {
	await requireKeyType.call(this, 'xonPlus', itemIndex);
	const domain = readDomain(this, itemIndex);
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
	const { rows } = await fetchExposures.call(this, domain, {
		since: typeof options.since === 'string' && options.since !== '' ? options.since : undefined,
		maxRows: readLimit(this, itemIndex),
		simplify: this.getNodeParameter('simplify', itemIndex, true) === true,
		itemIndex,
	});
	return rows;
}

async function plusDomainGetAll(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject[]> {
	await requireKeyType.call(this, 'xonPlus', itemIndex);
	const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
	const simplify = this.getNodeParameter('simplify', itemIndex, true) === true;
	const entries = await listDomains.call(
		this,
		{
			domain: typeof filters.domain === 'string' ? filters.domain.trim() : undefined,
			domainStatus: typeof filters.domainStatus === 'string' ? filters.domainStatus : undefined,
			processingStatus:
				typeof filters.processingStatus === 'string' ? filters.processingStatus : undefined,
		},
		readLimit(this, itemIndex),
		itemIndex,
	);
	return simplify ? entries.map((entry) => pick(entry, DOMAIN_ENTRY_SIMPLE_FIELDS)) : entries;
}

async function plusDomainCreate(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject[]> {
	await requireKeyType.call(this, 'xonPlus', itemIndex);
	const domain = readDomain(this, itemIndex);
	const { body } = await apiRequest.call(this, {
		host: 'xonPlus',
		method: 'POST',
		path: '/v2/partner/domains',
		body: { domain },
		authenticated: true,
		itemIndex,
	});
	return [body];
}

async function plusDomainGetQuota(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject[]> {
	await requireKeyType.call(this, 'xonPlus', itemIndex);
	const { body } = await apiRequest.call(this, {
		host: 'xonPlus',
		method: 'GET',
		path: '/v2/partner/quota',
		authenticated: true,
		itemIndex,
	});
	return [body];
}

type Handler = (this: IExecuteFunctions, itemIndex: number) => Promise<IDataObject[]>;

const HANDLERS: Record<string, Record<string, Handler>> = {
	email: {
		checkBreaches: emailCheckBreaches,
		getAnalytics: emailGetAnalytics,
	},
	breach: {
		get: breachGet,
		getAll: breachGetAll,
	},
	domain: {
		getBreaches: domainGetBreaches,
	},
	plusDomain: {
		create: plusDomainCreate,
		getAll: plusDomainGetAll,
		getExposures: plusDomainGetExposures,
		getQuota: plusDomainGetQuota,
		getSummary: plusDomainGetSummary,
	},
};

export async function runOperation(
	this: IExecuteFunctions,
	resource: string,
	operation: string,
	itemIndex: number,
): Promise<IDataObject[]> {
	const handler = HANDLERS[resource]?.[operation];
	if (handler === undefined) {
		throw new NodeOperationError(
			this.getNode(),
			`The operation '${operation}' is not available for the resource '${resource}'`,
			{ itemIndex },
		);
	}
	return await handler.call(this, itemIndex);
}
