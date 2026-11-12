import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { nodeProperties } from './descriptions';
import { runOperation } from './operations';
import { toNodeError } from './transport';

export class XposedOrNot implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'XposedOrNot',
		name: 'xposedOrNot',
		icon: { light: 'file:xposedornot.svg', dark: 'file:xposedornot.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Check email addresses and domains for data breach exposure',
		defaults: {
			name: 'XposedOrNot',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'xposedOrNotApi',
				required: false,
			},
		],
		properties: nodeProperties,
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const resource = this.getNodeParameter('resource', itemIndex) as string;
				const operation = this.getNodeParameter('operation', itemIndex) as string;
				const results = await runOperation.call(this, resource, operation, itemIndex);
				for (const json of results) {
					returnData.push({ json, pairedItem: { item: itemIndex } });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				throw toNodeError(this.getNode(), error, itemIndex);
			}
		}

		return [returnData];
	}
}
