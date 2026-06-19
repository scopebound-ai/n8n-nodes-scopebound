import {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  NodeOperationError,
} from 'n8n-workflow';

import {
  ScopeboundClient,
  ScopeboundAPIError,
  ScopeboundAuthError,
  ScopeboundNetworkError,
  ScopeboundNotFoundError,
  type EvaluationProfile,
  type EvaluationRequest,
  type EvaluationResult,
  type SourceFormat,
  type WorkflowDefinition,
} from '@scopebound/sdk';

// ─── Helpers (module-scoped — n8n's execute() rebinds `this` to IExecuteFunctions) ──

function hasCriticalViolations(result: EvaluationResult): boolean {
  return result.violations.some((v) => v.severity === 'critical');
}

async function evaluateOne(
  ctx: IExecuteFunctions,
  client: ScopeboundClient,
  request: EvaluationRequest,
): Promise<EvaluationResult> {
  try {
    return await client.evaluate(request);
  } catch (err) {
    if (err instanceof ScopeboundAuthError) {
      throw new NodeOperationError(
        ctx.getNode(),
        'Scopebound API key rejected — check the credential configuration',
      );
    }
    if (err instanceof ScopeboundNotFoundError) {
      throw new NodeOperationError(
        ctx.getNode(),
        `Scopebound role not found — verify the Role ID exists in the partner workspace (received: ${err.message})`,
      );
    }
    if (err instanceof ScopeboundNetworkError) {
      throw new NodeOperationError(ctx.getNode(), `Scopebound API unreachable — ${err.message}`);
    }
    if (err instanceof ScopeboundAPIError) {
      throw new NodeOperationError(
        ctx.getNode(),
        `Scopebound API error (${err.status}) — ${err.message}`,
      );
    }
    throw err;
  }
}

function routeItems(
  ctx: IExecuteFunctions,
  items: INodeExecutionData[],
  result: EvaluationResult,
  mode: 'warn' | 'block' | 'throw',
): INodeExecutionData[][] {
  const enriched = items.map((item, i) => ({
    json: { ...item.json, _scopebound: result },
    pairedItem: { item: i },
  }));

  if (mode === 'throw' && hasCriticalViolations(result)) {
    throw new NodeOperationError(
      ctx.getNode(),
      `Scopebound: critical violations — ${result.violations
        .filter((v) => v.severity === 'critical')
        .map((v) => `${v.code} on ${v.nodeId}`)
        .join('; ')}`,
    );
  }

  if (mode === 'block' && hasCriticalViolations(result)) {
    return [[], enriched];
  }

  return [enriched, []];
}

// ─── Node ─────────────────────────────────────────────────────────────────────

export class Scopebound implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Scopebound Scope Check',
    name: 'scopebound',
    icon: 'file:scopebound.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["mode"]}} · {{$parameter["evaluationProfile"].join(", ")}}',
    description:
      'Pre-execution scope enforcement: validates workflows against an agent role authorization scope before they run',
    defaults: {
      name: 'Scopebound Scope Check',
    },
    inputs: ['main'],
    outputs: ['main', 'main'],
    outputNames: ['Pass', 'Fail'],
    credentials: [
      {
        name: 'scopeboundApi',
        required: true,
      },
    ],
    properties: [
      {
        displayName: 'Role ID',
        name: 'roleId',
        type: 'string',
        default: '',
        required: true,
        placeholder: 'ap-processor',
        description:
          'The Scopebound agent role to evaluate against. Accepts either a role UUID or a role name.',
      },
      {
        displayName: 'Evaluation Profile',
        name: 'evaluationProfile',
        type: 'multiOptions',
        default: ['PRODUCTION_READINESS'],
        required: true,
        options: [
          { name: 'SOC1', value: 'SOC1', description: 'SOC1 controls (financial-system focused)' },
          {
            name: 'SOC2 Type II',
            value: 'SOC2_TYPE_II',
            description: 'SOC2 Type II Trust Services Criteria',
          },
          {
            name: 'Production Readiness',
            value: 'PRODUCTION_READINESS',
            description: 'Scope, idempotency, and bounds checking for production AI workflows',
          },
          { name: 'HIPAA', value: 'HIPAA', description: 'HIPAA-aligned controls' },
        ],
        description:
          'Which compliance profiles to evaluate against. Multiple profiles run in one pass.',
      },
      {
        displayName: 'Workflow Source',
        name: 'workflowSource',
        type: 'options',
        default: 'inputJson',
        options: [
          {
            name: 'From Input Field',
            value: 'inputJson',
            description: 'Read workflow definition from a JSON field on each input item',
          },
          {
            name: 'From Node Parameter',
            value: 'parameter',
            description: 'Paste a single workflow definition as JSON below',
          },
        ],
      },
      {
        displayName: 'Workflow Field',
        name: 'workflowField',
        type: 'string',
        default: 'workflow',
        required: true,
        displayOptions: {
          show: { workflowSource: ['inputJson'] },
        },
        description:
          'Name of the JSON field on each input item that contains the workflow definition',
      },
      {
        displayName: 'Workflow JSON',
        name: 'workflowJson',
        type: 'json',
        default: '{}',
        required: true,
        displayOptions: {
          show: { workflowSource: ['parameter'] },
        },
        description: 'Workflow definition as JSON. Used directly without per-item iteration.',
      },
      {
        displayName: 'Source Format',
        name: 'sourceFormat',
        type: 'options',
        default: 'savant',
        options: [
          {
            name: 'Savant (Canonical)',
            value: 'savant',
            description: 'Canonical Scopebound workflow shape',
          },
          { name: 'n8n', value: 'n8n', description: 'n8n workflow export — server translates' },
          { name: 'Make', value: 'make' },
          { name: 'Zapier', value: 'zapier' },
        ],
        description:
          'Workflow source format. Non-Savant formats invoke the server-side translator to produce the canonical DAG.',
      },
      {
        displayName: 'Mode',
        name: 'mode',
        type: 'options',
        default: 'warn',
        options: [
          {
            name: 'Warn Only',
            value: 'warn',
            description:
              'Always route to Pass output. Violations attached to item metadata as `_scopebound`. Safe default.',
          },
          {
            name: 'Block on Critical Violations',
            value: 'block',
            description:
              'Route items with critical violations to Fail output. Non-critical violations still pass.',
          },
          {
            name: 'Throw on Critical Violations',
            value: 'throw',
            description: 'Halt the workflow with a NodeOperationError when critical violations occur',
          },
        ],
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const credentials = await this.getCredentials('scopeboundApi');
    const apiKey = credentials.apiKey as string;
    const baseUrl = credentials.baseUrl as string;

    const client = new ScopeboundClient({ apiKey, baseUrl });

    const roleId = this.getNodeParameter('roleId', 0) as string;
    const evaluationProfile = this.getNodeParameter('evaluationProfile', 0) as EvaluationProfile[];
    const workflowSource = this.getNodeParameter('workflowSource', 0) as 'inputJson' | 'parameter';
    const sourceFormat = this.getNodeParameter('sourceFormat', 0) as SourceFormat;
    const mode = this.getNodeParameter('mode', 0) as 'warn' | 'block' | 'throw';

    const inputItems = this.getInputData();

    if (workflowSource === 'parameter') {
      const workflowRaw = this.getNodeParameter('workflowJson', 0) as
        | string
        | Record<string, unknown>;
      const workflow =
        typeof workflowRaw === 'string'
          ? (JSON.parse(workflowRaw) as Record<string, unknown>)
          : workflowRaw;

      const result = await evaluateOne(this, client, {
        roleId,
        evaluationProfile,
        workflow:
          sourceFormat === 'savant' ? (workflow as unknown as WorkflowDefinition) : undefined,
        workflowRaw: sourceFormat !== 'savant' ? workflow : undefined,
        sourceFormat: sourceFormat !== 'savant' ? sourceFormat : undefined,
      });

      return routeItems(this, inputItems, result, mode);
    }

    const workflowField = this.getNodeParameter('workflowField', 0) as string;

    const passOut: INodeExecutionData[] = [];
    const failOut: INodeExecutionData[] = [];

    for (let i = 0; i < inputItems.length; i++) {
      const item = inputItems[i];
      const workflow = (item.json as Record<string, unknown>)[workflowField] as
        | Record<string, unknown>
        | undefined;

      if (!workflow) {
        throw new NodeOperationError(
          this.getNode(),
          `Input item ${i} has no workflow definition at field "${workflowField}"`,
          { itemIndex: i },
        );
      }

      const result = await evaluateOne(this, client, {
        roleId,
        evaluationProfile,
        workflow:
          sourceFormat === 'savant' ? (workflow as unknown as WorkflowDefinition) : undefined,
        workflowRaw: sourceFormat !== 'savant' ? workflow : undefined,
        sourceFormat: sourceFormat !== 'savant' ? sourceFormat : undefined,
      });

      const enriched: INodeExecutionData = {
        json: { ...item.json, _scopebound: result },
        pairedItem: { item: i },
      };

      if (mode === 'throw' && hasCriticalViolations(result)) {
        throw new NodeOperationError(
          this.getNode(),
          `Scopebound: critical violations found for item ${i} — ${result.violations
            .filter((v) => v.severity === 'critical')
            .map((v) => `${v.code} on ${v.nodeId}`)
            .join('; ')}`,
          { itemIndex: i },
        );
      }

      if (mode === 'block' && hasCriticalViolations(result)) {
        failOut.push(enriched);
      } else {
        passOut.push(enriched);
      }
    }

    return [passOut, failOut];
  }
}
