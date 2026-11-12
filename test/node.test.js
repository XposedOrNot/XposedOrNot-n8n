'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { XposedOrNot } = require('../dist/nodes/XposedOrNot/XposedOrNot.node.js');
const { RATE_LIMIT_MESSAGE } = require('../dist/nodes/XposedOrNot/transport.js');
const { version } = require('../package.json');
const {
	startMock,
	createContext,
	COMMUNITY_HOST,
	PLUS_HOST,
	COMMUNITY_KEY,
	PLUS_KEY,
} = require('./harness');

const node = new XposedOrNot();

async function run(handler, setup) {
	const mock = await startMock(handler);
	try {
		const context = createContext(mock, { mode: 'manual', ...setup });
		const [output] = await node.execute.call(context);
		return { output, json: output.map((item) => item.json), requests: mock.requests };
	} finally {
		await mock.close();
	}
}

async function runExpectingFailure(handler, setup) {
	const mock = await startMock(handler);
	try {
		const context = createContext(mock, { mode: 'manual', ...setup });
		const error = await node.execute.call(context).then(
			() => undefined,
			(caught) => caught,
		);
		assert.ok(error, 'the node should have stopped');
		return { error, requests: mock.requests };
	} finally {
		await mock.close();
	}
}

const BREACH = {
	breachID: 'Adobe',
	breachedDate: '2013-10-01T00:00:00+00:00',
	addedDate: '2023-11-08T06:30:03+00:00',
	domain: 'adobe.com',
	industry: 'Information Technology',
	logo: 'https://xposedornot.com/static/logos/Adobe.png',
	passwordRisk: 'easytocrack',
	searchable: true,
	sensitive: false,
	verified: true,
	breachType: 'DataBreach',
	exposedData: ['Usernames', 'Passwords'],
	exposedRecords: 152403035,
	exposureDescription: 'Sample description',
	referenceURL: 'https://example.com/adobe',
};

test('email check without a key calls the community host and reports breaches', async () => {
	const { json, requests, output } = await run(
		() => ({ body: { breaches: [['Adobe', 'Dropbox']], email: 'nathan@example.com' } }),
		{ params: { resource: 'email', operation: 'checkBreaches', email: ' nathan@example.com ' } },
	);
	assert.deepEqual(json, [
		{
			email: 'nathan@example.com',
			breached: true,
			breaches: ['Adobe', 'Dropbox'],
			breach_count: 2,
		},
	]);
	assert.deepEqual(output[0].pairedItem, { item: 0 });
	assert.equal(requests.length, 1);
	assert.equal(requests[0].host, COMMUNITY_HOST);
	assert.equal(requests[0].method, 'GET');
	assert.equal(requests[0].path, '/v1/check-email/nathan%40example.com');
	assert.equal(requests[0].apiKey, undefined);
	assert.equal(requests[0].headers['user-agent'], `n8n-nodes-xposedornot/${version}`);
});

test('email not found is a normal result, whether the API answers 200 or 404', async () => {
	const params = { resource: 'email', operation: 'checkBreaches', email: 'clean@example.com' };
	const expected = [{ email: 'clean@example.com', breached: false, breaches: [], breach_count: 0 }];

	const viaBody = await run(() => ({ body: { Error: 'Not found', email: null } }), { params });
	assert.deepEqual(viaBody.json, expected);

	const viaStatus = await run(() => ({ status: 404, body: { Error: 'Not found' } }), { params });
	assert.deepEqual(viaStatus.json, expected);
});

test('email check stops on an unexpected community answer', async () => {
	const { error } = await runExpectingFailure(() => ({ body: { Error: 'Service busy' } }), {
		params: { resource: 'email', operation: 'checkBreaches', email: 'nathan@example.com' },
	});
	assert.equal(error.name, 'NodeApiError');
	assert.equal(error.description, 'Service busy');
});

test('an invalid email is rejected before any request is sent', async () => {
	const { error, requests } = await runExpectingFailure(() => ({ body: {} }), {
		params: { resource: 'email', operation: 'checkBreaches', email: 'not-an-email' },
	});
	assert.equal(error.name, 'NodeOperationError');
	assert.match(error.message, /not a valid email address/);
	assert.equal(requests.length, 0);
});

test('email check with a xonPlus key uses the v3 endpoint with the key', async () => {
	const params = { resource: 'email', operation: 'checkBreaches', email: 'nathan@example.com' };
	const found = await run(
		() => ({
			body: {
				status: 'success',
				email: 'nathan@example.com',
				breaches: ['Adobe', { breach_id: 'Canva', domain: 'canva.com' }],
			},
		}),
		{ params, credentials: PLUS_KEY },
	);
	assert.deepEqual(found.json[0].breaches, ['Adobe', 'Canva']);
	assert.equal(found.json[0].breach_count, 2);
	assert.equal(found.requests[0].host, PLUS_HOST);
	assert.equal(found.requests[0].path, '/v3/check-email/nathan%40example.com');
	assert.equal(found.requests[0].apiKey, PLUS_KEY.apiKey);

	const missing = await run(() => ({ status: 404, body: { detail: 'Email not found' } }), {
		params,
		credentials: PLUS_KEY,
	});
	assert.equal(missing.json[0].breached, false);
});

test('a community key is not sent on the public email check', async () => {
	const { requests } = await run(() => ({ body: { breaches: [['Adobe']] } }), {
		params: { resource: 'email', operation: 'checkBreaches', email: 'nathan@example.com' },
		credentials: COMMUNITY_KEY,
	});
	assert.equal(requests[0].host, COMMUNITY_HOST);
	assert.equal(requests[0].apiKey, undefined);
});

test('a list of emails yields one linked item each', async () => {
	const emails = ['a@example.com', 'b@example.com', 'c@example.com'];
	const { output } = await run(
		(request) =>
			request.path.includes('b%40')
				? { body: { Error: 'Not found', email: null } }
				: { body: { breaches: [['Adobe']] } },
		{
			items: emails.map((email) => ({ json: { email } })),
			params: emails.map((email) => ({ resource: 'email', operation: 'checkBreaches', email })),
		},
	);
	assert.deepEqual(
		output.map((item) => [item.json.email, item.json.breached, item.pairedItem.item]),
		[
			['a@example.com', true, 0],
			['b@example.com', false, 1],
			['c@example.com', true, 2],
		],
	);
});

test('analytics is simplified by default and raw on request', async () => {
	const body = {
		BreachMetrics: {
			risk: [{ risk_label: 'High', risk_score: 82 }],
			passwords_strength: [{ EasyToCrack: 2, PlainText: 1, StrongHash: 0, Unknown: 3 }],
			yearwise_details: [{ y2012: 0, y2013: 1, y2019: 2 }],
			industry: [[['misc', 1]]],
		},
		BreachesSummary: { site: 'Adobe;Canva' },
		ExposedBreaches: { breaches_details: [{ breach: 'Adobe' }, { breach: 'Canva' }] },
		ExposedPastes: null,
		PasteMetrics: null,
		PastesSummary: { cnt: 4, domain: '', tmpstmp: '' },
	};
	const params = { resource: 'email', operation: 'getAnalytics', email: 'nathan@example.com' };

	const simple = await run(() => ({ body }), { params });
	assert.deepEqual(simple.json[0], {
		email: 'nathan@example.com',
		breached: true,
		breaches: ['Adobe', 'Canva'],
		breach_count: 2,
		risk_label: 'High',
		risk_score: 82,
		password_strength: { EasyToCrack: 2, PlainText: 1, StrongHash: 0, Unknown: 3 },
		breaches_by_year: { 2013: 1, 2019: 2 },
		paste_count: 4,
	});
	assert.ok(Object.keys(simple.json[0]).length <= 10);
	assert.equal(simple.requests[0].path, '/v1/breach-analytics');
	assert.equal(simple.requests[0].query.email, 'nathan@example.com');

	const raw = await run(() => ({ body }), { params: { ...params, simplify: false } });
	assert.deepEqual(raw.json[0], body);
});

test('analytics for an unknown email is an empty result', async () => {
	const { json } = await run(
		() => ({
			body: {
				BreachMetrics: null,
				BreachesSummary: { site: '' },
				ExposedBreaches: null,
				ExposedPastes: null,
				PasteMetrics: null,
				PastesSummary: { cnt: 0, domain: '', tmpstmp: '' },
			},
		}),
		{ params: { resource: 'email', operation: 'getAnalytics', email: 'clean@example.com' } },
	);
	assert.equal(json[0].breached, false);
	assert.equal(json[0].breach_count, 0);
	assert.equal(json[0].risk_label, null);
	assert.equal(json[0].paste_count, 0);
});

test('breach get returns one breach and reports an unknown ID', async () => {
	const params = { resource: 'breach', operation: 'get', breachId: 'Adobe' };
	const found = await run(() => ({ body: { status: 'success', exposedBreaches: [BREACH] } }), {
		params,
	});
	assert.equal(found.requests[0].query.breach_id, 'Adobe');
	assert.equal(found.json[0].breachID, 'Adobe');
	assert.equal(Object.keys(found.json[0]).length, 10);
	assert.equal(found.json[0].logo, undefined);

	const raw = await run(() => ({ body: { exposedBreaches: [BREACH] } }), {
		params: { ...params, simplify: false },
	});
	assert.deepEqual(raw.json[0], BREACH);

	const { error } = await runExpectingFailure(
		() => ({ body: { status: 'Not Found', message: 'No breaches found', exposedBreaches: null } }),
		{ params: { ...params, breachId: 'Nope' } },
	);
	assert.equal(error.name, 'NodeApiError');
	assert.equal(error.httpCode, '404');
	assert.match(error.message, /No breach has the ID 'Nope'/);
});

test('breach get many applies limit, return all and the domain filter', async () => {
	const catalog = Array.from({ length: 120 }, (_, index) => ({
		...BREACH,
		breachID: `Breach${index}`,
	}));
	const handler = () => ({ body: { status: 'success', exposedBreaches: catalog } });
	const params = { resource: 'breach', operation: 'getAll' };

	const limited = await run(handler, { params });
	assert.equal(limited.json.length, 50);
	assert.equal(Object.keys(limited.json[0]).length, 10);

	const custom = await run(handler, { params: { ...params, limit: 7, simplify: false } });
	assert.equal(custom.json.length, 7);
	assert.equal(custom.json[0].logo, BREACH.logo);

	const all = await run(handler, {
		params: { ...params, returnAll: true, filters: { domain: 'adobe.com' } },
	});
	assert.equal(all.json.length, 120);
	assert.equal(all.requests[0].query.domain, 'adobe.com');

	const none = await run(() => ({ body: { status: 'Not Found', exposedBreaches: null } }), {
		params,
	});
	assert.deepEqual(none.json, []);
});

test('community domain breaches need a community key', async () => {
	const params = { resource: 'domain', operation: 'getBreaches' };

	const noKey = await runExpectingFailure(() => ({ body: {} }), { params });
	assert.equal(noKey.error.name, 'NodeOperationError');
	assert.match(noKey.error.message, /needs a Community API key/);
	assert.equal(noKey.requests.length, 0);

	const wrongKey = await runExpectingFailure(() => ({ body: {} }), {
		params,
		credentials: PLUS_KEY,
	});
	assert.match(wrongKey.error.message, /holds a xonPlus key/);
	assert.equal(wrongKey.requests.length, 0);
});

test('community domain breaches return one row per exposed address', async () => {
	const rows = Array.from({ length: 60 }, (_, index) => ({
		email: `user${index}@example.com`,
		domain: 'example.com',
		breach: 'Adobe',
	}));
	const body = { status: 'success', metrics: { Breaches_Details: rows, Yearly_Metrics: {} } };
	const params = { resource: 'domain', operation: 'getBreaches' };

	const limited = await run(() => ({ body }), { params, credentials: COMMUNITY_KEY });
	assert.equal(limited.json.length, 50);
	assert.deepEqual(limited.json[0], rows[0]);
	assert.equal(limited.requests[0].method, 'POST');
	assert.equal(limited.requests[0].path, '/v1/domain-breaches/');
	assert.equal(limited.requests[0].host, COMMUNITY_HOST);
	assert.equal(limited.requests[0].apiKey, COMMUNITY_KEY.apiKey);

	const all = await run(() => ({ body }), {
		params: { ...params, returnAll: true },
		credentials: COMMUNITY_KEY,
	});
	assert.equal(all.json.length, 60);

	const raw = await run(() => ({ body }), {
		params: { ...params, simplify: false },
		credentials: COMMUNITY_KEY,
	});
	assert.deepEqual(raw.json, [body]);
});

test('xonPlus operations refuse a community key', async () => {
	for (const operation of ['create', 'getAll', 'getExposures', 'getQuota', 'getSummary']) {
		const { error, requests } = await runExpectingFailure(() => ({ body: {} }), {
			params: { resource: 'plusDomain', operation, domain: 'example.com' },
			credentials: COMMUNITY_KEY,
		});
		assert.match(error.message, /needs a xonPlus API key/, operation);
		assert.equal(requests.length, 0, operation);
	}
});

test('xonPlus domain list follows page tokens and honours the limit', async () => {
	const entry = (index) => ({
		entry_id: `id-${index}`,
		domain: `site${index}.example.com`,
		status: 'approved',
		processing_status: 'completed',
		processing_detail: 'completed',
		processing_started_at: null,
		processing_completed_at: null,
		processing_attempts: 1,
		submitted_at: '2026-01-01T00:00:00Z',
		verified_at: '2026-01-02T00:00:00Z',
		rejection_reason: null,
		source: 'api',
		record_count: index,
		record_count_at: '2026-02-01T00:00:00Z',
	});
	const handler = (request) => {
		const start = request.query.cursor ? Number(request.query.cursor) : 0;
		const size = Number(request.query.limit);
		const end = Math.min(start + size, 1200);
		return {
			body: {
				plan: { tier: 'pro' },
				total_count: 1200,
				domains: Array.from({ length: end - start }, (_, index) => entry(start + index)),
				next_page_token: end < 1200 ? String(end) : null,
			},
		};
	};
	const params = { resource: 'plusDomain', operation: 'getAll' };

	const all = await run(handler, {
		params: {
			...params,
			returnAll: true,
			filters: { domain: '*.example.com', domainStatus: 'approved', processingStatus: 'completed' },
		},
		credentials: PLUS_KEY,
	});
	assert.equal(all.json.length, 1200);
	assert.equal(all.requests.length, 3);
	assert.deepEqual(
		all.requests.map((request) => request.query.cursor),
		[undefined, '500', '1000'],
	);
	assert.equal(all.requests[0].host, PLUS_HOST);
	assert.equal(all.requests[0].path, '/v2/partner/domains');
	assert.equal(all.requests[0].apiKey, PLUS_KEY.apiKey);
	assert.equal(all.requests[0].query.domain, '*.example.com');
	assert.equal(all.requests[0].query.domain_status, 'approved');
	assert.equal(all.requests[0].query.processing_status, 'completed');
	assert.equal(Object.keys(all.json[0]).length, 9);

	const limited = await run(handler, {
		params: { ...params, limit: 3, simplify: false },
		credentials: PLUS_KEY,
	});
	assert.equal(limited.json.length, 3);
	assert.equal(limited.requests.length, 1);
	assert.equal(limited.requests[0].query.limit, '3');
	assert.equal(Object.keys(limited.json[0]).length, 14);
});

test('xonPlus domain list falls back to offsets when no token is returned', async () => {
	const handler = (request) => {
		const start = Number(request.query.offset ?? 0);
		const size = Number(request.query.limit);
		const end = Math.min(start + size, 700);
		return {
			body: {
				total_count: 700,
				domains: Array.from({ length: end - start }, (_, index) => ({
					domain: `site${start + index}.example.com`,
					status: 'approved',
				})),
			},
		};
	};
	const { json, requests } = await run(handler, {
		params: { resource: 'plusDomain', operation: 'getAll', returnAll: true },
		credentials: PLUS_KEY,
	});
	assert.equal(json.length, 700);
	assert.deepEqual(
		requests.map((request) => request.query.offset),
		[undefined, '500'],
	);
});

test('xonPlus exposures follow the cursor and merge breach details', async () => {
	const info = {
		Adobe: {
			breached_date: '2013-10-01',
			password_risk: 'easytocrack',
			xposed_data: 'Emails;Passwords',
			xposed_records: 152403035,
			logo: 'adobe.png',
			xposure_desc: 'Sample',
		},
	};
	const handler = (request) => {
		const second = request.query.cursor === 'page-2';
		return {
			body: {
				domain: 'example.com',
				as_of: second ? '2026-11-12T10:00:05Z' : '2026-11-12T10:00:00Z',
				detailed_breach_info: info,
				breaches_details: second
					? [{ email: 'c@example.com', domain: 'example.com', breach: 'Unknown' }]
					: [
							{ email: 'a@example.com', domain: 'example.com', breach: 'Adobe' },
							{ email: 'b@example.com', domain: 'example.com', breach: 'Adobe' },
						],
				has_more: !second,
				next_cursor: second ? null : 'page-2',
			},
		};
	};
	const params = {
		resource: 'plusDomain',
		operation: 'getExposures',
		domain: 'Example.com',
		returnAll: true,
		options: { since: '2026-11-01T00:00:00Z' },
	};

	const simple = await run(handler, { params, credentials: PLUS_KEY });
	assert.equal(simple.requests.length, 2);
	assert.equal(simple.requests[0].path, '/v2/partner/domain-summary');
	assert.equal(simple.requests[0].query.domain, 'example.com');
	assert.equal(simple.requests[0].query.details, 'true');
	assert.equal(simple.requests[0].query.limit, '5000');
	assert.equal(simple.requests[0].query.since, '2026-11-01T00:00:00Z');
	assert.equal(simple.requests[1].query.cursor, 'page-2');
	assert.deepEqual(simple.json, [
		{
			email: 'a@example.com',
			domain: 'example.com',
			breach: 'Adobe',
			breached_date: '2013-10-01',
			password_risk: 'easytocrack',
			xposed_data: 'Emails;Passwords',
			xposed_records: 152403035,
		},
		{
			email: 'b@example.com',
			domain: 'example.com',
			breach: 'Adobe',
			breached_date: '2013-10-01',
			password_risk: 'easytocrack',
			xposed_data: 'Emails;Passwords',
			xposed_records: 152403035,
		},
		{ email: 'c@example.com', domain: 'example.com', breach: 'Unknown' },
	]);

	const raw = await run(handler, {
		params: { ...params, simplify: false, returnAll: false, limit: 1 },
		credentials: PLUS_KEY,
	});
	assert.equal(raw.json.length, 1);
	assert.equal(raw.requests.length, 1);
	assert.equal(raw.requests[0].query.limit, '1');
	assert.equal(raw.json[0].logo, 'adobe.png');
	assert.equal(raw.json[0].email, 'a@example.com');
});

test('xonPlus summary, create and quota', async () => {
	const summary = {
		domain: 'example.com',
		breach_count: 3,
		yearly_metrics: { 2019: 2 },
		verified_domains: ['example.com'],
		yearly_breach_hierarchy: {},
		domain_summary: { 'example.com': 3 },
		seniority_summary: {},
		breach_summary: { Adobe: 3 },
		top10_breaches: { Adobe: 3 },
		detailed_breach_info: {},
		breaches_details: null,
		since: null,
		as_of: '2026-11-12T10:00:00Z',
	};
	const simple = await run(() => ({ body: summary }), {
		params: { resource: 'plusDomain', operation: 'getSummary', domain: 'example.com' },
		credentials: PLUS_KEY,
	});
	assert.equal(simple.requests[0].query.details, undefined);
	assert.equal(simple.requests[0].query.since, undefined);
	assert.deepEqual(Object.keys(simple.json[0]), [
		'domain',
		'breach_count',
		'since',
		'as_of',
		'yearly_metrics',
		'domain_summary',
		'breach_summary',
		'top10_breaches',
	]);

	const raw = await run(() => ({ body: summary }), {
		params: {
			resource: 'plusDomain',
			operation: 'getSummary',
			domain: 'example.com',
			simplify: false,
			options: { since: '2026-11-01T00:00:00Z' },
		},
		credentials: PLUS_KEY,
	});
	assert.deepEqual(raw.json[0], summary);
	assert.equal(raw.requests[0].query.since, '2026-11-01T00:00:00Z');

	const created = await run(
		() => ({
			status: 202,
			body: { message: 'queued', domain: 'new.example.com', status: 'pending_validation' },
		}),
		{
			params: { resource: 'plusDomain', operation: 'create', domain: 'new.example.com' },
			credentials: PLUS_KEY,
		},
	);
	assert.equal(created.requests[0].method, 'POST');
	assert.equal(created.requests[0].path, '/v2/partner/domains');
	assert.deepEqual(created.requests[0].body, { domain: 'new.example.com' });
	assert.equal(created.json[0].status, 'pending_validation');

	const quota = await run(() => ({ body: { plan_limit: 10, used: 4, available_slots: 6 } }), {
		params: { resource: 'plusDomain', operation: 'getQuota' },
		credentials: PLUS_KEY,
	});
	assert.equal(quota.requests[0].path, '/v2/partner/quota');
	assert.equal(quota.json[0].available_slots, 6);

	const invalid = await runExpectingFailure(() => ({ body: {} }), {
		params: { resource: 'plusDomain', operation: 'create', domain: 'https://example.com/x' },
		credentials: PLUS_KEY,
	});
	assert.match(invalid.error.message, /not a valid domain name/);
	assert.equal(invalid.requests.length, 0);
});

test('a rate limit with a short Retry-After is waited out and retried', async () => {
	const started = Date.now();
	const { json, requests } = await run(
		(request, count) =>
			count === 1
				? { status: 429, headers: { 'retry-after': '1' }, body: { detail: 'slow down' } }
				: { body: { breaches: [['Adobe']] } },
		{ params: { resource: 'email', operation: 'checkBreaches', email: 'nathan@example.com' } },
	);
	assert.equal(requests.length, 2);
	assert.equal(json[0].breached, true);
	assert.ok(Date.now() - started >= 1000);
});

test('a rate limit without a usable Retry-After stops with the xonAPI+ message', async () => {
	const params = { resource: 'email', operation: 'checkBreaches', email: 'nathan@example.com' };

	const bare = await runExpectingFailure(() => ({ status: 429, body: { detail: 'slow down' } }), {
		params,
	});
	assert.equal(bare.error.message, RATE_LIMIT_MESSAGE);
	assert.equal(
		RATE_LIMIT_MESSAGE,
		'Rate limit reached. For higher limits, see xonAPI+: https://plus.xposedornot.com/products/api',
	);
	assert.equal(bare.error.httpCode, '429');
	assert.equal(bare.requests.length, 1);

	const long = await runExpectingFailure(
		() => ({ status: 429, headers: { 'retry-after': '3600' }, body: {} }),
		{ params },
	);
	assert.equal(long.error.message, RATE_LIMIT_MESSAGE);
	assert.match(long.error.description, /3600 seconds/);
	assert.equal(long.requests.length, 1);

	const persistent = await runExpectingFailure(
		() => ({ status: 429, headers: { 'retry-after': '0' }, body: {} }),
		{ params },
	);
	assert.equal(persistent.requests.length, 3);
});

test('a rejected key stops the node, or becomes an item when continuing on fail', async () => {
	const params = { resource: 'plusDomain', operation: 'getQuota' };
	const handler = () => ({ status: 401, body: { detail: 'Invalid or inactive API key' } });

	const stopped = await runExpectingFailure(handler, { params, credentials: PLUS_KEY });
	assert.equal(stopped.error.name, 'NodeApiError');
	assert.equal(stopped.error.message, 'The API key was not accepted');
	assert.equal(stopped.error.description, 'Invalid or inactive API key');
	assert.equal(stopped.error.httpCode, '401');

	const continued = await run(handler, { params, credentials: PLUS_KEY, continueOnFail: true });
	assert.deepEqual(continued.json, [{ error: 'The API key was not accepted' }]);
	assert.deepEqual(continued.output[0].pairedItem, { item: 0 });
});

test('validation messages from the API are surfaced', async () => {
	const { error } = await runExpectingFailure(
		() => ({
			status: 422,
			body: { detail: [{ loc: ['query', 'domain'], msg: 'Field required' }] },
		}),
		{
			params: { resource: 'plusDomain', operation: 'getSummary', domain: 'example.com' },
			credentials: PLUS_KEY,
		},
	);
	assert.equal(error.description, 'Field required');
	assert.equal(error.httpCode, '422');
});
