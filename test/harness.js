'use strict';

const http = require('node:http');

async function startMock(handler) {
	const requests = [];
	const server = http.createServer((req, res) => {
		const chunks = [];
		req.on('data', (chunk) => chunks.push(chunk));
		req.on('end', async () => {
			const url = new URL(req.url, 'http://mock.local');
			const raw = Buffer.concat(chunks).toString('utf8');
			const request = {
				method: req.method,
				path: url.pathname,
				query: Object.fromEntries(url.searchParams.entries()),
				headers: req.headers,
				host: req.headers['x-mock-host'],
				apiKey: req.headers['x-api-key'],
				body: raw === '' ? undefined : JSON.parse(raw),
			};
			requests.push(request);
			const reply = (await handler(request, requests.length)) ?? { status: 404, body: {} };
			res.writeHead(reply.status ?? 200, {
				'content-type': 'application/json',
				...(reply.headers ?? {}),
			});
			res.end(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body ?? {}));
		});
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	return {
		url: `http://127.0.0.1:${server.address().port}`,
		requests,
		close: () => new Promise((resolve) => server.close(resolve)),
	};
}

function createContext(mock, setup = {}) {
	const {
		params = {},
		credentials,
		items = [{ json: {} }],
		mode = 'trigger',
		staticData = {},
		continueOnFail = false,
		pollBudgetMs,
	} = setup;
	const warnings = [];

	const lookup = (name, itemIndex) => {
		const source = Array.isArray(params) ? params[itemIndex ?? 0] : params;
		return source[name];
	};

	async function httpRequest(options) {
		const target = new URL(options.url);
		const url = new URL(target.pathname, mock.url);
		for (const [key, value] of Object.entries(options.qs ?? {})) {
			url.searchParams.set(key, String(value));
		}
		const headers = { ...(options.headers ?? {}), 'x-mock-host': target.host };
		const init = { method: options.method ?? 'GET', headers };
		if (options.body !== undefined) {
			init.body = JSON.stringify(options.body);
			headers['content-type'] = 'application/json';
		}
		const response = await fetch(url, init);
		const text = await response.text();
		let body = text;
		try {
			body = JSON.parse(text);
		} catch {
			body = text;
		}
		if (!options.ignoreHttpStatusErrors && response.status >= 400) {
			throw new Error(`Request failed with status code ${response.status}`);
		}
		return options.returnFullResponse
			? {
					statusCode: response.status,
					body,
					headers: Object.fromEntries(response.headers.entries()),
				}
			: body;
	}

	const context = {
		warnings,
		staticData,
		getInputData: () => items,
		getNode: () => ({
			name: 'XposedOrNot',
			type: 'n8n-nodes-xposedornot.xposedOrNot',
			typeVersion: 1,
			parameters: {},
			credentials: credentials ? { xposedOrNotApi: { id: '1', name: 'Test' } } : undefined,
		}),
		getCredentials: async () => {
			if (!credentials) {
				throw new Error('Node does not have any credentials set');
			}
			return credentials;
		},
		getNodeParameter: (name, second, third) => {
			const executing = typeof second === 'number';
			const value = lookup(name, executing ? second : 0);
			return value === undefined ? (executing ? third : second) : value;
		},
		continueOnFail: () => continueOnFail,
		getMode: () => mode,
		getWorkflowStaticData: () => staticData,
		logger: { warn: (message) => warnings.push(message) },
		helpers: {
			httpRequest,
			httpRequestWithAuthentication: async function (name, options) {
				const stored = await this.getCredentials(name);
				return await httpRequest({
					...options,
					headers: { ...(options.headers ?? {}), 'x-api-key': stored.apiKey },
				});
			},
		},
	};
	if (pollBudgetMs !== undefined) {
		context.getPollBudgetMs = () => pollBudgetMs;
	}
	return context;
}

const COMMUNITY_HOST = 'api.xposedornot.com';
const PLUS_HOST = 'plus-api.xposedornot.com';
const COMMUNITY_KEY = { keyType: 'community', apiKey: 'community-test-key' };
const PLUS_KEY = { keyType: 'xonPlus', apiKey: 'plus-test-key' };

module.exports = {
	startMock,
	createContext,
	COMMUNITY_HOST,
	PLUS_HOST,
	COMMUNITY_KEY,
	PLUS_KEY,
};
