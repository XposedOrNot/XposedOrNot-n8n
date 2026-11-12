'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { XposedOrNotTrigger } = require('../dist/nodes/XposedOrNot/XposedOrNotTrigger.node.js');
const { startMock, createContext, PLUS_HOST, COMMUNITY_KEY, PLUS_KEY } = require('./harness');

const trigger = new XposedOrNotTrigger();

const BREACH_INFO = {
	Adobe: {
		breached_date: '2013-10-01',
		password_risk: 'easytocrack',
		xposed_data: 'Emails;Passwords',
		xposed_records: 152403035,
		logo: 'adobe.png',
	},
};

function createApi(state) {
	return (request) => {
		if (request.apiKey !== PLUS_KEY.apiKey) {
			return { status: 401, body: { detail: 'Invalid or inactive API key' } };
		}
		if (request.path === '/v2/partner/domains') {
			return {
				body: {
					total_count: state.domains.length,
					domains: state.domains.map((domain) => ({
						domain,
						status: 'approved',
						processing_status: 'completed',
					})),
				},
			};
		}
		if (request.path === '/v2/partner/domain-summary') {
			const domain = request.query.domain;
			if (state.failing?.includes(domain)) {
				return { status: 500, body: { detail: 'Temporary fault' } };
			}
			if (state.notReady?.includes(domain)) {
				return { status: 404, body: { detail: 'Domain is still processing' } };
			}
			if (request.query.details !== 'true') {
				return { body: { domain, breach_count: 0, since: request.query.since, as_of: state.now } };
			}
			const rows = (state.rows[domain] ?? []).filter(
				(row) => request.query.since === undefined || row.added > request.query.since,
			);
			const pageSize = state.pageSize ?? 5000;
			const start = request.query.cursor ? Number(request.query.cursor) : 0;
			const page = rows.slice(start, start + pageSize);
			const hasMore = start + pageSize < rows.length;
			return {
				body: {
					domain,
					as_of: state.now,
					detailed_breach_info: BREACH_INFO,
					breaches_details: page.map(({ email, breach }) => ({ email, domain, breach })),
					has_more: hasMore,
					next_cursor: hasMore ? String(start + pageSize) : null,
				},
			};
		}
		return { status: 404, body: { detail: 'Unknown route' } };
	};
}

async function withApi(state, callback) {
	const mock = await startMock(createApi(state));
	try {
		return await callback(mock);
	} finally {
		await mock.close();
	}
}

const summaryCalls = (mock) =>
	mock.requests.filter((request) => request.path === '/v2/partner/domain-summary');

test('the first poll sets a starting point per domain and emits nothing', async () => {
	const state = {
		now: '2026-11-12T10:00:00Z',
		domains: ['alpha.example.com', 'beta.example.com'],
		rows: {
			'alpha.example.com': [
				{ email: 'old@alpha.example.com', breach: 'Adobe', added: '2026-01-01T00:00:00Z' },
			],
		},
	};
	await withApi(state, async (mock) => {
		const staticData = {};
		const context = createContext(mock, { credentials: PLUS_KEY, staticData });
		const result = await trigger.poll.call(context);

		assert.equal(result, null);
		assert.deepEqual(staticData.watermarks, {
			'alpha.example.com': state.now,
			'beta.example.com': state.now,
		});
		assert.equal(mock.requests[0].path, '/v2/partner/domains');
		assert.equal(mock.requests[0].host, PLUS_HOST);
		assert.equal(mock.requests[0].query.domain_status, 'approved');
		assert.equal(mock.requests[0].query.processing_status, 'completed');
		const calls = summaryCalls(mock);
		assert.equal(calls.length, 2);
		for (const call of calls) {
			assert.equal(call.query.details, undefined);
			assert.ok(!Number.isNaN(Date.parse(call.query.since)));
		}
	});
});

test('later polls emit only new exposure, page through it and advance the starting point', async () => {
	const state = {
		now: '2026-11-12T10:00:00Z',
		domains: ['alpha.example.com'],
		rows: { 'alpha.example.com': [] },
		pageSize: 2,
	};
	await withApi(state, async (mock) => {
		const staticData = {};
		const context = createContext(mock, { credentials: PLUS_KEY, staticData });
		assert.equal(await trigger.poll.call(context), null);

		state.rows['alpha.example.com'] = [
			{ email: 'old@alpha.example.com', breach: 'Adobe', added: '2026-11-01T00:00:00Z' },
			{ email: 'a@alpha.example.com', breach: 'Adobe', added: '2026-11-12T11:00:00Z' },
			{ email: 'b@alpha.example.com', breach: 'Adobe', added: '2026-11-12T11:00:00Z' },
			{ email: 'c@alpha.example.com', breach: 'Other', added: '2026-11-12T11:30:00Z' },
		];
		state.now = '2026-11-12T12:00:00Z';
		mock.requests.length = 0;

		const second = await trigger.poll.call(context);
		assert.deepEqual(
			second[0].map((item) => item.json),
			[
				{
					email: 'a@alpha.example.com',
					domain: 'alpha.example.com',
					breach: 'Adobe',
					breached_date: '2013-10-01',
					password_risk: 'easytocrack',
					xposed_data: 'Emails;Passwords',
					xposed_records: 152403035,
					detected_at: '2026-11-12T12:00:00Z',
				},
				{
					email: 'b@alpha.example.com',
					domain: 'alpha.example.com',
					breach: 'Adobe',
					breached_date: '2013-10-01',
					password_risk: 'easytocrack',
					xposed_data: 'Emails;Passwords',
					xposed_records: 152403035,
					detected_at: '2026-11-12T12:00:00Z',
				},
				{
					email: 'c@alpha.example.com',
					domain: 'alpha.example.com',
					breach: 'Other',
					detected_at: '2026-11-12T12:00:00Z',
				},
			],
		);
		const calls = summaryCalls(mock);
		assert.equal(calls.length, 2);
		assert.equal(calls[0].query.since, '2026-11-12T10:00:00Z');
		assert.equal(calls[0].query.details, 'true');
		assert.equal(calls[0].query.limit, '5000');
		assert.equal(calls[1].query.cursor, '2');
		assert.equal(staticData.watermarks['alpha.example.com'], '2026-11-12T12:00:00Z');

		state.now = '2026-11-12T13:00:00Z';
		assert.equal(await trigger.poll.call(context), null);
		assert.equal(staticData.watermarks['alpha.example.com'], '2026-11-12T13:00:00Z');
	});
});

test('a domain added later starts silently while existing domains keep reporting', async () => {
	const state = {
		now: '2026-11-12T10:00:00Z',
		domains: ['alpha.example.com'],
		rows: {},
	};
	await withApi(state, async (mock) => {
		const staticData = {};
		const context = createContext(mock, { credentials: PLUS_KEY, staticData });
		await trigger.poll.call(context);

		state.domains.push('beta.example.com');
		state.rows = {
			'alpha.example.com': [
				{ email: 'a@alpha.example.com', breach: 'Adobe', added: '2026-11-12T11:00:00Z' },
			],
			'beta.example.com': [
				{ email: 'history@beta.example.com', breach: 'Adobe', added: '2026-11-12T11:00:00Z' },
			],
		};
		state.now = '2026-11-12T12:00:00Z';

		const result = await trigger.poll.call(context);
		assert.deepEqual(
			result[0].map((item) => item.json.email),
			['a@alpha.example.com'],
		);
		assert.equal(staticData.watermarks['beta.example.com'], '2026-11-12T12:00:00Z');
	});
});

test('the Domains field limits which domains are watched', async () => {
	const state = {
		now: '2026-11-12T10:00:00Z',
		domains: ['alpha.example.com', 'beta.example.com', 'gamma.example.com'],
		rows: {},
	};
	await withApi(state, async (mock) => {
		const staticData = {};
		const context = createContext(mock, {
			credentials: PLUS_KEY,
			staticData,
			params: { domains: ['beta.example.com', 'removed.example.com'] },
		});
		await trigger.poll.call(context);
		assert.deepEqual(Object.keys(staticData.watermarks), ['beta.example.com']);
		assert.deepEqual(
			summaryCalls(mock).map((call) => call.query.domain),
			['beta.example.com'],
		);
	});
});

test('a domain that is not ready is skipped without losing the others', async () => {
	const state = {
		now: '2026-11-12T10:00:00Z',
		domains: ['alpha.example.com', 'beta.example.com'],
		rows: {},
		notReady: ['alpha.example.com'],
	};
	await withApi(state, async (mock) => {
		const staticData = {};
		const context = createContext(mock, { credentials: PLUS_KEY, staticData });
		assert.equal(await trigger.poll.call(context), null);
		assert.deepEqual(staticData.watermarks, { 'beta.example.com': state.now });
	});
});

test('a fault part-way keeps finished domains and leaves the rest for the next poll', async () => {
	const state = {
		now: '2026-11-12T10:00:00Z',
		domains: ['alpha.example.com', 'beta.example.com'],
		rows: {},
	};
	await withApi(state, async (mock) => {
		const staticData = {
			watermarks: {
				'alpha.example.com': '2026-11-12T08:00:00Z',
				'beta.example.com': '2026-11-12T09:00:00Z',
			},
		};
		state.rows = {
			'alpha.example.com': [
				{ email: 'a@alpha.example.com', breach: 'Adobe', added: '2026-11-12T09:30:00Z' },
			],
			'beta.example.com': [
				{ email: 'b@beta.example.com', breach: 'Adobe', added: '2026-11-12T09:30:00Z' },
			],
		};
		state.failing = ['beta.example.com'];
		const context = createContext(mock, { credentials: PLUS_KEY, staticData });

		const result = await trigger.poll.call(context);
		assert.deepEqual(
			result[0].map((item) => item.json.email),
			['a@alpha.example.com'],
		);
		assert.equal(staticData.watermarks['alpha.example.com'], state.now);
		assert.equal(staticData.watermarks['beta.example.com'], '2026-11-12T09:00:00Z');
		assert.equal(context.warnings.length, 1);

		state.failing = [];
		state.now = '2026-11-12T11:00:00Z';
		const retry = await trigger.poll.call(context);
		assert.deepEqual(
			retry[0].map((item) => item.json.email),
			['b@beta.example.com'],
		);
	});
});

test('a fault before any progress fails the poll and keeps the saved state', async () => {
	const state = {
		now: '2026-11-12T10:00:00Z',
		domains: ['alpha.example.com'],
		rows: {},
		failing: ['alpha.example.com'],
	};
	await withApi(state, async (mock) => {
		const staticData = { watermarks: { 'alpha.example.com': '2026-11-12T08:00:00Z' } };
		const context = createContext(mock, { credentials: PLUS_KEY, staticData });
		await assert.rejects(trigger.poll.call(context), (error) => {
			assert.equal(error.name, 'NodeApiError');
			assert.equal(error.httpCode, '500');
			return true;
		});
		assert.deepEqual(staticData.watermarks, { 'alpha.example.com': '2026-11-12T08:00:00Z' });
	});
});

test('an exhausted poll budget leaves remaining domains for the next poll', async () => {
	const state = {
		now: '2026-11-12T10:00:00Z',
		domains: ['alpha.example.com', 'beta.example.com'],
		rows: {},
	};
	await withApi(state, async (mock) => {
		const staticData = {};
		const context = createContext(mock, {
			credentials: PLUS_KEY,
			staticData,
			pollBudgetMs: 0.001,
		});
		await new Promise((resolve) => setTimeout(resolve, 5));
		const result = await trigger.poll.call(context);
		assert.equal(result, null);
		assert.ok(Object.keys(staticData.watermarks).length <= 1);
	});
});

test('a manual test run returns a small sample and does not touch the saved state', async () => {
	const state = {
		now: '2026-11-12T10:00:00Z',
		domains: ['alpha.example.com', 'beta.example.com'],
		rows: {
			'beta.example.com': Array.from({ length: 9 }, (_, index) => ({
				email: `user${index}@beta.example.com`,
				breach: 'Adobe',
				added: '2026-01-01T00:00:00Z',
			})),
		},
	};
	await withApi(state, async (mock) => {
		const staticData = {};
		const context = createContext(mock, {
			credentials: PLUS_KEY,
			staticData,
			mode: 'manual',
			params: { simplify: false },
		});
		const result = await trigger.poll.call(context);
		assert.equal(result[0].length, 5);
		assert.equal(result[0][0].json.logo, 'adobe.png');
		assert.deepEqual(staticData, {});
		const calls = summaryCalls(mock);
		assert.equal(calls[1].query.limit, '5');
		assert.equal(calls[1].query.since, undefined);
	});
});

test('the trigger refuses a community key before calling the API', async () => {
	await withApi({ domains: [], rows: {} }, async (mock) => {
		const context = createContext(mock, { credentials: COMMUNITY_KEY });
		await assert.rejects(trigger.poll.call(context), /needs a xonPlus API key/);
		assert.equal(mock.requests.length, 0);
	});
});

test('the domain picker lists ready domains in order', async () => {
	const state = { domains: ['zeta.example.com', 'alpha.example.com'], rows: {} };
	await withApi(state, async (mock) => {
		const context = createContext(mock, { credentials: PLUS_KEY });
		const options = await trigger.methods.loadOptions.getDomains.call(context);
		assert.deepEqual(options, [
			{ name: 'alpha.example.com', value: 'alpha.example.com' },
			{ name: 'zeta.example.com', value: 'zeta.example.com' },
		]);
	});
});
