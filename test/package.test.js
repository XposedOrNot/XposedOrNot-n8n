'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const pkg = require('../package.json');
const { XposedOrNotApi } = require('../dist/credentials/XposedOrNotApi.credentials.js');
const { XposedOrNot } = require('../dist/nodes/XposedOrNot/XposedOrNot.node.js');
const { XposedOrNotTrigger } = require('../dist/nodes/XposedOrNot/XposedOrNotTrigger.node.js');
const { parseRetryAfter } = require('../dist/nodes/XposedOrNot/transport.js');

function sourceFiles(directory) {
	return fs.readdirSync(path.join(root, directory), { recursive: true }).filter((file) => {
		return String(file).endsWith('.ts');
	});
}

test('package.json meets the n8n verification rules', () => {
	assert.equal(pkg.name, 'n8n-nodes-xposedornot');
	assert.ok(pkg.keywords.includes('n8n-community-node-package'));
	assert.equal(pkg.license, 'MIT');
	assert.equal(pkg.repository.url, 'https://github.com/XposedOrNot/XposedOrNot-n8n.git');
	assert.deepEqual(Object.keys(pkg.dependencies ?? {}), []);
	assert.equal(pkg.n8n.strict, true);
	for (const file of [...pkg.n8n.nodes, ...pkg.n8n.credentials]) {
		assert.ok(fs.existsSync(path.join(root, file)), file);
	}
});

test('the source reads no environment variables and touches no files', () => {
	for (const directory of ['nodes', 'credentials']) {
		for (const file of sourceFiles(directory)) {
			const source = fs.readFileSync(path.join(root, directory, String(file)), 'utf8');
			assert.doesNotMatch(
				source,
				/process\.env|require\(|from 'fs'|from 'node:|child_process/,
				file,
			);
		}
	}
});

test('the credential hides the key, sends it as x-api-key and tests the right host', () => {
	const credential = new XposedOrNotApi();
	assert.equal(credential.name, 'xposedOrNotApi');
	const key = credential.properties.find((property) => property.name === 'apiKey');
	assert.equal(key.typeOptions.password, true);
	const keyType = credential.properties.find((property) => property.name === 'keyType');
	assert.deepEqual(
		keyType.options.map((option) => option.value),
		['community', 'xonPlus'],
	);
	assert.deepEqual(credential.authenticate.properties.headers, {
		'x-api-key': '={{$credentials.apiKey}}',
	});

	const resolve = (expression, $credentials) =>
		new Function('$credentials', `return ${expression.replace(/^=\{\{|\}\}$/g, '')}`)($credentials);
	const { request } = credential.test;
	assert.equal(
		resolve(request.baseURL, { keyType: 'xonPlus' }),
		'https://plus-api.xposedornot.com',
	);
	assert.equal(resolve(request.url, { keyType: 'xonPlus' }), '/v2/partner/quota');
	assert.equal(resolve(request.method, { keyType: 'xonPlus' }), 'GET');
	assert.equal(resolve(request.baseURL, { keyType: 'community' }), 'https://api.xposedornot.com');
	assert.equal(resolve(request.url, { keyType: 'community' }), '/v1/domain-breaches/');
	assert.equal(resolve(request.method, { keyType: 'community' }), 'POST');
});

test('the node and trigger describe themselves as n8n expects', () => {
	const node = new XposedOrNot().description;
	assert.equal(node.name, 'xposedOrNot');
	assert.equal(node.usableAsTool, true);
	assert.equal(node.credentials[0].required, false);
	const resource = node.properties.find((property) => property.name === 'resource');
	assert.deepEqual(
		resource.options.map((option) => option.value),
		['breach', 'domain', 'email', 'plusDomain'],
	);
	const operations = node.properties
		.filter((property) => property.name === 'operation')
		.flatMap((property) => property.options.map((option) => option.value));
	assert.deepEqual(operations.sort(), [
		'checkBreaches',
		'create',
		'get',
		'getAll',
		'getAll',
		'getAnalytics',
		'getBreaches',
		'getExposures',
		'getQuota',
		'getSummary',
	]);

	const trigger = new XposedOrNotTrigger().description;
	assert.equal(trigger.name, 'xposedOrNotTrigger');
	assert.equal(trigger.polling, true);
	assert.deepEqual(trigger.inputs, []);
	assert.equal(trigger.usableAsTool, undefined);
	assert.equal(trigger.credentials[0].required, true);
});

test('the example workflows use operations and parameters the nodes really have', () => {
	const described = {
		'n8n-nodes-xposedornot.xposedOrNot': new XposedOrNot().description,
		'n8n-nodes-xposedornot.xposedOrNotTrigger': new XposedOrNotTrigger().description,
	};
	const files = fs
		.readdirSync(path.join(root, 'examples'))
		.filter((file) => file.endsWith('.json'));
	assert.deepEqual(files.sort(), ['domain-exposure-ticket.json', 'signup-breach-check.json']);

	for (const file of files) {
		const workflow = JSON.parse(fs.readFileSync(path.join(root, 'examples', file), 'utf8'));
		const names = workflow.nodes.map((node) => node.name);
		for (const [source, outputs] of Object.entries(workflow.connections)) {
			assert.ok(names.includes(source), `${file}: ${source}`);
			for (const link of outputs.main.flat()) {
				assert.ok(names.includes(link.node), `${file}: ${link.node}`);
			}
		}
		const ours = workflow.nodes.filter((node) => node.type in described);
		assert.ok(ours.length > 0, file);
		for (const node of ours) {
			const { properties } = described[node.type];
			assert.equal(node.credentials, undefined, `${file}: no credential IDs in examples`);
			for (const [name, value] of Object.entries(node.parameters)) {
				if (name === 'pollTimes') continue;
				const matches = properties.filter((property) => property.name === name);
				assert.ok(matches.length > 0, `${file}: ${name}`);
				if (name === 'resource' || name === 'operation') {
					const allowed = matches.flatMap((property) =>
						property.options.map((option) => option.value),
					);
					assert.ok(allowed.includes(value), `${file}: ${name}=${value}`);
				}
			}
		}
	}
});

test('Retry-After is read as seconds or as a date', () => {
	const now = Date.parse('2026-11-12T10:00:00Z');
	assert.equal(parseRetryAfter('7'), 7);
	assert.equal(parseRetryAfter('1.2'), 2);
	assert.equal(parseRetryAfter('Thu, 12 Nov 2026 10:00:30 GMT', now), 30);
	assert.equal(parseRetryAfter('Thu, 12 Nov 2026 09:00:00 GMT', now), 0);
	assert.equal(parseRetryAfter(undefined), undefined);
	assert.equal(parseRetryAfter('soon'), undefined);
});
