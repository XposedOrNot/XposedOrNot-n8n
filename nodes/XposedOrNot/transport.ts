import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INode,
	IPollFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

import { version } from '../../package.json';

export type XonContext = IExecuteFunctions | IPollFunctions | ILoadOptionsFunctions;

export type KeyType = 'community' | 'xonPlus';

export interface ApiRequest {
	host: KeyType;
	method: IHttpRequestMethods;
	path: string;
	qs?: IDataObject;
	body?: IDataObject;
	authenticated?: boolean;
	acceptStatuses?: number[];
	itemIndex?: number;
}

export interface ApiResponse {
	statusCode: number;
	body: IDataObject;
	headers: IDataObject;
}

export const CREDENTIAL_NAME = 'xposedOrNotApi';

export const RATE_LIMIT_MESSAGE =
	'Rate limit reached. For higher limits, see xonAPI+: https://plus.xposedornot.com/products/api';

const HOSTS: Record<KeyType, string> = {
	community: 'https://api.xposedornot.com',
	xonPlus: 'https://plus-api.xposedornot.com',
};

const KEY_LABELS: Record<KeyType, string> = {
	community: 'Community',
	xonPlus: 'xonPlus',
};

const USER_AGENT = `n8n-nodes-xposedornot/${version}`;
const MAX_RATE_LIMIT_RETRIES = 2;
const MAX_RATE_LIMIT_WAIT_SECONDS = 60;

export function toNodeError(
	node: INode,
	error: unknown,
	itemIndex?: number,
): NodeApiError | NodeOperationError {
	if (error instanceof NodeApiError || error instanceof NodeOperationError) {
		return error;
	}
	return new NodeApiError(node, error as JsonObject, { itemIndex });
}

export async function getKeyType(this: XonContext): Promise<KeyType | undefined> {
	if (!this.getNode().credentials?.[CREDENTIAL_NAME]) {
		return undefined;
	}
	const credentials = await this.getCredentials(CREDENTIAL_NAME);
	return credentials.keyType === 'xonPlus' ? 'xonPlus' : 'community';
}

export async function requireKeyType(
	this: XonContext,
	needed: KeyType,
	itemIndex?: number,
): Promise<void> {
	const actual = await getKeyType.call(this);
	if (actual === needed) {
		return;
	}
	const label = KEY_LABELS[needed];
	const message =
		actual === undefined
			? `This operation needs a ${label} API key`
			: `This operation needs a ${label} API key, but the selected credential holds a ${KEY_LABELS[actual]} key`;
	throw new NodeOperationError(this.getNode(), message, {
		description: `Select an 'XposedOrNot API' credential with 'Key Type' set to '${label}'.`,
		itemIndex,
	});
}

export function parseRetryAfter(value: unknown, now: number = Date.now()): number | undefined {
	if (value === undefined || value === null || value === '') {
		return undefined;
	}
	const text = String(Array.isArray(value) ? value[0] : value).trim();
	if (/^\d+(\.\d+)?$/.test(text)) {
		return Math.ceil(Number(text));
	}
	const date = Date.parse(text);
	if (Number.isNaN(date)) {
		return undefined;
	}
	return Math.max(0, Math.ceil((date - now) / 1000));
}

function toObject(body: unknown): IDataObject {
	if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
		return body as IDataObject;
	}
	if (typeof body === 'string' && body.trim() !== '') {
		try {
			const parsed = JSON.parse(body) as unknown;
			if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
				return parsed as IDataObject;
			}
		} catch {
			return { message: body.slice(0, 500) };
		}
	}
	if (Array.isArray(body)) {
		return { data: body };
	}
	return {};
}

export function extractDetail(body: IDataObject): string | undefined {
	const detail = body.detail ?? body.Error ?? body.message;
	if (typeof detail === 'string' && detail.trim() !== '') {
		return detail;
	}
	if (Array.isArray(detail)) {
		const parts = detail
			.map((entry) =>
				entry !== null && typeof entry === 'object' ? (entry as IDataObject).msg : entry,
			)
			.filter((entry) => typeof entry === 'string' && entry !== '');
		if (parts.length > 0) {
			return parts.join('; ');
		}
	}
	return undefined;
}

function statusMessage(statusCode: number): string {
	if (statusCode === 401 || statusCode === 403) {
		return 'The API key was not accepted';
	}
	if (statusCode === 404) {
		return 'The requested item was not found';
	}
	if (statusCode >= 500) {
		return 'XposedOrNot could not complete the request';
	}
	return 'XposedOrNot rejected the request';
}

export async function apiRequest(this: XonContext, request: ApiRequest): Promise<ApiResponse> {
	const options: IHttpRequestOptions = {
		method: request.method,
		url: `${HOSTS[request.host]}${request.path}`,
		headers: {
			Accept: 'application/json',
			'User-Agent': USER_AGENT,
		},
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};
	if (request.qs !== undefined) {
		options.qs = request.qs;
	}
	if (request.body !== undefined) {
		options.body = request.body;
	}

	const acceptStatuses = request.acceptStatuses ?? [];

	for (let attempt = 0; ; attempt++) {
		const response = (
			request.authenticated
				? await this.helpers.httpRequestWithAuthentication.call(this, CREDENTIAL_NAME, options)
				: await this.helpers.httpRequest(options)
		) as { statusCode: number; body: unknown; headers?: IDataObject };

		const statusCode = Number(response.statusCode);
		const headers = response.headers ?? {};
		const body = toObject(response.body);

		if (statusCode === 429) {
			const retryAfter = parseRetryAfter(headers['retry-after']);
			if (
				retryAfter !== undefined &&
				retryAfter <= MAX_RATE_LIMIT_WAIT_SECONDS &&
				attempt < MAX_RATE_LIMIT_RETRIES
			) {
				await sleep(retryAfter * 1000);
				continue;
			}
			throw new NodeApiError(this.getNode(), body as JsonObject, {
				message: RATE_LIMIT_MESSAGE,
				description:
					retryAfter === undefined
						? 'Wait a while before running this again.'
						: `Wait ${retryAfter} seconds before running this again.`,
				httpCode: '429',
				itemIndex: request.itemIndex,
			});
		}

		if (statusCode >= 200 && statusCode < 300) {
			return { statusCode, body, headers };
		}
		if (acceptStatuses.includes(statusCode)) {
			return { statusCode, body, headers };
		}

		throw new NodeApiError(this.getNode(), body as JsonObject, {
			message: statusMessage(statusCode),
			description: extractDetail(body) ?? `XposedOrNot answered with status ${statusCode}.`,
			httpCode: String(statusCode),
			itemIndex: request.itemIndex,
		});
	}
}
