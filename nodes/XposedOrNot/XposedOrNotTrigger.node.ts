import type {
	IDataObject,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes } from 'n8n-workflow';

import { fetchExposures, fetchStartingPoint, listDomains } from './partner';
import { requireKeyType, toNodeError } from './transport';

const READY_DOMAINS = { domainStatus: 'approved', processingStatus: 'completed' };
const MANUAL_SAMPLE_ROWS = 5;
const MANUAL_SAMPLE_DOMAINS = 5;
const POLL_BUDGET_SHARE = 0.8;

function domainNames(entries: IDataObject[]): string[] {
	const names: string[] = [];
	for (const entry of entries) {
		if (typeof entry.domain === 'string' && entry.domain !== '') {
			names.push(entry.domain);
		}
	}
	return names;
}

function toItems(rows: IDataObject[], detectedAt?: string): INodeExecutionData[] {
	return rows.map((row) => ({
		json: detectedAt === undefined ? row : { ...row, detected_at: detectedAt },
	}));
}

function pollDeadline(context: IPollFunctions): number | undefined {
	if (typeof context.getPollBudgetMs !== 'function') {
		return undefined;
	}
	const budget = context.getPollBudgetMs();
	return Number.isFinite(budget) && budget > 0
		? Date.now() + budget * POLL_BUDGET_SHARE
		: undefined;
}

export class XposedOrNotTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'XposedOrNot Trigger',
		name: 'xposedOrNotTrigger',
		icon: { light: 'file:xposedornot.svg', dark: 'file:xposedornot.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: 'New breach exposure',
		description: 'Starts the workflow when an address on your domains appears in a new breach',
		defaults: {
			name: 'XposedOrNot Trigger',
		},
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'xposedOrNotApi',
				required: true,
			},
		],
		properties: [
			{
				displayName:
					'This trigger needs a xonPlus key. The first run sets the starting point and returns nothing, so only exposure found after that starts the workflow.',
				name: 'notice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Domain Names or IDs',
				name: 'domains',
				type: 'multiOptions',
				typeOptions: {
					loadOptionsMethod: 'getDomains',
				},
				default: [],
				description:
					'The domains to watch. Leave empty to watch every approved domain on your account. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Simplify',
				name: 'simplify',
				type: 'boolean',
				default: true,
				description:
					'Whether to return a simplified version of the response instead of the raw data',
			},
		],
	};

	methods = {
		loadOptions: {
			async getDomains(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				await requireKeyType.call(this, 'xonPlus');
				const names = domainNames(await listDomains.call(this, READY_DOMAINS));
				return names.sort().map((name) => ({ name, value: name }));
			},
		},
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		await requireKeyType.call(this, 'xonPlus');

		const selected = this.getNodeParameter('domains', []) as string[];
		const simplify = this.getNodeParameter('simplify', true) === true;
		const ready = domainNames(await listDomains.call(this, READY_DOMAINS));
		const domains = selected.length > 0 ? ready.filter((name) => selected.includes(name)) : ready;

		if (this.getMode() === 'manual') {
			for (const domain of domains.slice(0, MANUAL_SAMPLE_DOMAINS)) {
				const { rows, asOf } = await fetchExposures.call(this, domain, {
					maxRows: MANUAL_SAMPLE_ROWS,
					simplify,
				});
				if (rows.length > 0) {
					return [toItems(rows, asOf)];
				}
			}
			return null;
		}

		const staticData = this.getWorkflowStaticData('node');
		const watermarks: IDataObject = { ...((staticData.watermarks as IDataObject) ?? {}) };
		const ordered = [...domains].sort((a, b) =>
			String(watermarks[a] ?? '').localeCompare(String(watermarks[b] ?? '')),
		);
		const deadline = pollDeadline(this);
		const items: INodeExecutionData[] = [];
		let progressed = false;

		for (const domain of ordered) {
			if (deadline !== undefined && Date.now() > deadline) {
				break;
			}
			try {
				const since = watermarks[domain];
				if (typeof since !== 'string' || since === '') {
					watermarks[domain] = await fetchStartingPoint.call(this, domain);
					progressed = true;
					continue;
				}
				const requestedAt = new Date().toISOString();
				const { rows, asOf } = await fetchExposures.call(this, domain, { since, simplify });
				const nextSince = asOf ?? requestedAt;
				items.push(...toItems(rows, nextSince));
				watermarks[domain] = nextSince;
				progressed = true;
			} catch (error) {
				if (error instanceof NodeApiError && error.httpCode === '404') {
					continue;
				}
				if (!progressed) {
					throw toNodeError(this.getNode(), error);
				}
				this.logger.warn(
					`XposedOrNot Trigger stopped early at ${domain} and will continue on the next poll: ${(error as Error).message}`,
				);
				break;
			}
		}

		staticData.watermarks = watermarks;
		return items.length > 0 ? [items] : null;
	}
}
