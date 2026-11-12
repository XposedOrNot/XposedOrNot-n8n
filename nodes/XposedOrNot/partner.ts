import type { IDataObject } from 'n8n-workflow';

import { apiRequest, type XonContext } from './transport';

export interface DomainFilters {
	domain?: string;
	domainStatus?: string;
	processingStatus?: string;
}

export interface ExposureResult {
	rows: IDataObject[];
	asOf?: string;
}

const DOMAIN_PAGE_SIZE = 500;
const EXPOSURE_PAGE_SIZE = 5000;
const MAX_PAGES = 10000;

const SIMPLE_BREACH_FIELDS = ['breached_date', 'password_risk', 'xposed_data', 'xposed_records'];

function asObject(value: unknown): IDataObject | undefined {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as IDataObject)
		: undefined;
}

function asString(value: unknown): string | undefined {
	return typeof value === 'string' && value !== '' ? value : undefined;
}

export async function listDomains(
	this: XonContext,
	filters: DomainFilters = {},
	maxItems?: number,
	itemIndex?: number,
): Promise<IDataObject[]> {
	const collected: IDataObject[] = [];
	let cursor: string | undefined;
	let offset = 0;

	for (let page = 0; page < MAX_PAGES; page++) {
		const remaining = maxItems === undefined ? DOMAIN_PAGE_SIZE : maxItems - collected.length;
		if (remaining <= 0) {
			break;
		}
		const pageSize = Math.min(DOMAIN_PAGE_SIZE, remaining);
		const qs: IDataObject = { limit: pageSize };
		if (filters.domain) qs.domain = filters.domain;
		if (filters.domainStatus) qs.domain_status = filters.domainStatus;
		if (filters.processingStatus) qs.processing_status = filters.processingStatus;
		if (cursor !== undefined) {
			qs.cursor = cursor;
		} else if (offset > 0) {
			qs.offset = offset;
		}

		const { body } = await apiRequest.call(this, {
			host: 'xonPlus',
			method: 'GET',
			path: '/v2/partner/domains',
			qs,
			authenticated: true,
			itemIndex,
		});

		const entries = Array.isArray(body.domains) ? (body.domains as IDataObject[]) : [];
		collected.push(...entries);

		const nextCursor = asString(body.next_page_token) ?? asString(body.next_cursor);
		if (nextCursor !== undefined) {
			if (nextCursor === cursor) {
				break;
			}
			cursor = nextCursor;
			continue;
		}

		const total = typeof body.total_count === 'number' ? body.total_count : undefined;
		const mayHaveMore =
			cursor === undefined &&
			entries.length === pageSize &&
			(total === undefined || offset + entries.length < total);
		if (!mayHaveMore) {
			break;
		}
		offset += entries.length;
	}

	return maxItems === undefined ? collected : collected.slice(0, maxItems);
}

function findBreachInfo(breachInfo: unknown, breach: string | undefined): IDataObject | undefined {
	if (breach === undefined) {
		return undefined;
	}
	if (Array.isArray(breachInfo)) {
		return (breachInfo as IDataObject[]).find(
			(entry) =>
				asObject(entry) !== undefined &&
				(entry.breach === breach || entry.breach_id === breach || entry.breachID === breach),
		);
	}
	return asObject(asObject(breachInfo)?.[breach]);
}

export function mergeExposureRow(
	row: IDataObject,
	breachInfo: unknown,
	simplify: boolean,
): IDataObject {
	const breach =
		asString(row.breach) ?? asString(row.breach_id) ?? asString(row.breach_name) ?? undefined;
	const info = findBreachInfo(breachInfo, breach);
	if (info === undefined) {
		return { ...row };
	}
	if (!simplify) {
		return { ...info, ...row };
	}
	const merged: IDataObject = { ...row };
	for (const field of SIMPLE_BREACH_FIELDS) {
		if (info[field] !== undefined) {
			merged[field] = info[field];
		}
	}
	return merged;
}

export async function fetchExposures(
	this: XonContext,
	domain: string,
	options: { since?: string; maxRows?: number; simplify?: boolean; itemIndex?: number } = {},
): Promise<ExposureResult> {
	const rows: IDataObject[] = [];
	let cursor: string | undefined;
	let asOf: string | undefined;

	for (let page = 0; page < MAX_PAGES; page++) {
		const remaining =
			options.maxRows === undefined ? EXPOSURE_PAGE_SIZE : options.maxRows - rows.length;
		if (remaining <= 0) {
			break;
		}
		const qs: IDataObject = {
			domain,
			details: true,
			limit: Math.min(EXPOSURE_PAGE_SIZE, remaining),
		};
		if (options.since) qs.since = options.since;
		if (cursor !== undefined) qs.cursor = cursor;

		const { body } = await apiRequest.call(this, {
			host: 'xonPlus',
			method: 'GET',
			path: '/v2/partner/domain-summary',
			qs,
			authenticated: true,
			itemIndex: options.itemIndex,
		});

		if (asOf === undefined) {
			asOf = asString(body.as_of);
		}

		const details = Array.isArray(body.breaches_details)
			? (body.breaches_details as IDataObject[])
			: [];
		for (const row of details) {
			rows.push(mergeExposureRow(row, body.detailed_breach_info, options.simplify ?? true));
		}

		const nextCursor = asString(body.next_cursor);
		if (body.has_more !== true || nextCursor === undefined || nextCursor === cursor) {
			break;
		}
		cursor = nextCursor;
	}

	return {
		rows: options.maxRows === undefined ? rows : rows.slice(0, options.maxRows),
		asOf,
	};
}

export async function fetchStartingPoint(this: XonContext, domain: string): Promise<string> {
	const requestedAt = new Date().toISOString();
	const { body } = await apiRequest.call(this, {
		host: 'xonPlus',
		method: 'GET',
		path: '/v2/partner/domain-summary',
		qs: { domain, since: requestedAt },
		authenticated: true,
	});
	return asString(body.as_of) ?? requestedAt;
}
