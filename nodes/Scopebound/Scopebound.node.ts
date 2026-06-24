import type {
  IExecuteFunctions,
  IHttpRequestOptions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

// ─── Local types (formerly imported from @scopebound/sdk) ─────────────────────

type EvaluationProfile = 'SOC1' | 'SOC2_TYPE_II' | 'PRODUCTION_READINESS' | 'HIPAA';
type SourceFormat = 'savant' | 'n8n' | 'make' | 'zapier';
type EvaluationStatus = 'pass' | 'fail' | 'warnings';
type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

interface EvaluationViolation {
  code: string;
  nodeId: string;
  severity: Severity;
  message: string;
  remediation?: string;
}

interface EvaluationResult {
  evaluationId: string;
  status: EvaluationStatus;
  productionReadinessStatus?: EvaluationStatus;
  violations: EvaluationViolation[];
  profile: EvaluationProfile[];
  attestationToken?: string;
  evaluatedAt: string;
}

interface EvaluationRequest {
  roleId: string;
  evaluationProfile: EvaluationProfile[];
  workflow?: Record<string, unknown>;
  workflowRaw?: Record<string, unknown>;
  sourceFormat?: SourceFormat;
}

// ─── Wire transcoding ────────────────────────────────────────────────────────
//
// The server speaks snake_case. We expose camelCase to n8n. We need to:
//   - REQUEST: map our known top-level fields to snake_case keys, but NOT
//     recurse into the user's workflow content (which is opaque to us — for
//     n8n format, the server's translator expects the original camelCase
//     shape like typeVersion, nodes[].parameters, connections{}).
//   - RESPONSE: recursively camelCase every key — the server's response
//     format is fully snake_case throughout (violations[].node_id, etc.)

function toCamelCase(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function camelCaseKeysDeep(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map((item) => camelCaseKeysDeep(item));
  }
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
        toCamelCase(k),
        camelCaseKeysDeep(v),
      ]),
    );
  }
  return obj;
}

function buildRequestBody(request: EvaluationRequest): JsonObject {
  // Explicit top-level mapping. The workflow / workflow_raw VALUES are
  // passed through unchanged — they're user-controlled data the server
  // interprets according to source_format.
  const body: JsonObject = {
    role_id: request.roleId,
    evaluation_profile: request.evaluationProfile,
  };
  if (request.workflow !== undefined) {
    body.workflow = request.workflow as JsonObject;
  }
  if (request.workflowRaw !== undefined) {
    body.workflow_raw = request.workflowRaw as JsonObject;
  }
  if (request.sourceFormat !== undefined) {
    body.source_format = request.sourceFormat;
  }
  return body;
}

// ─── Error introspection ─────────────────────────────────────────────────────

interface HttpErrorLike {
  message?: string;
  httpCode?: string | number;
  statusCode?: number;
  response?: {
    status?: number;
    body?: unknown;
    data?: unknown;
  };
  cause?: {
    message?: string;
    statusCode?: number;
    response?: {
      status?: number;
      body?: unknown;
      data?: unknown;
    };
  };
}

function extractStatus(err: HttpErrorLike): number {
  const candidates: Array<string | number | undefined> = [
    err.httpCode,
    err.statusCode,
    err.response?.status,
    err.cause?.statusCode,
    err.cause?.response?.status,
  ];
  for (const c of candidates) {
    if (c === undefined || c === null) continue;
    const parsed = typeof c === 'string' ? parseInt(c, 10) : c;
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  // Fallback: parse from axios-style message "Request failed with status code 400"
  const match = err.message?.match(/status code (\d+)/i);
  if (match) {
    return parseInt(match[1], 10);
  }
  return 0;
}

function extractResponseBody(err: HttpErrorLike): string {
  const candidates: unknown[] = [
    err.response?.body,
    err.response?.data,
    err.cause?.response?.body,
    err.cause?.response?.data,
  ];
  for (const c of candidates) {
    if (c === undefined || c === null) continue;
    if (typeof c === 'string') return c.slice(0, 500);
    try {
      return JSON.stringify(c).slice(0, 500);
    } catch {
      // Fall through
    }
  }
  return '';
}

// ─── HTTP call via n8n's vetted helpers ──────────────────────────────────────

async function evaluateOne(
  ctx: IExecuteFunctions,
  baseUrl: string,
  apiKey: string,
  request: EvaluationRequest,
): Promise<EvaluationResult> {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/workflow/evaluate`;
  const body = buildRequestBody(request);

  const options: IHttpRequestOptions = {
    method: 'POST',
    url,
    headers: {
      'X-Scopebound-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body,
    json: true,
  };

  let response: unknown;
  try {
    response = await ctx.helpers.httpRequest(options);
  } catch (raw) {
    const err = raw as HttpErrorLike;
    const status = extractStatus(err);
    const bodyMsg = extractResponseBody(err);
    const baseMsg = err.message || err.cause?.message || 'unknown error';
    const detail = bodyMsg ? ` — server response: ${bodyMsg}` : '';
    const rawAsJson = raw as JsonObject;

    if (status === 401 || status === 403) {
      throw new NodeApiError(ctx.getNode(), rawAsJson, {
        message: `Scopebound API key rejected (HTTP ${status}) — check the credential configuration${detail}`,
        httpCode: String(status),
      });
    }
    if (status === 404) {
      throw new NodeApiError(ctx.getNode(), rawAsJson, {
        message: `Scopebound role not found (HTTP 404) — verify the Role ID or Name exists in the partner workspace${detail}`,
        httpCode: '404',
      });
    }
    if (status === 400 || status === 422) {
      throw new NodeApiError(ctx.getNode(), rawAsJson, {
        message: `Scopebound rejected the request (HTTP ${status}) — ${baseMsg}${detail}`,
        httpCode: String(status),
      });
    }
    if (status >= 500) {
      throw new NodeApiError(ctx.getNode(), rawAsJson, {
        message: `Scopebound enforcement plane error (HTTP ${status}) — ${baseMsg}${detail}`,
        httpCode: String(status),
      });
    }
    if (status > 0) {
      throw new NodeApiError(ctx.getNode(), rawAsJson, {
        message: `Scopebound API error (HTTP ${status}) — ${baseMsg}${detail}`,
        httpCode: String(status),
      });
    }
    // No status code extractable — likely a connectivity error (DNS, refused, timeout)
    throw new NodeApiError(ctx.getNode(), rawAsJson, {
      message: `Scopebound API unreachable — ${baseMsg}`,
    });
  }

  return camelCaseKeysDeep(response) as EvaluationResult;
}

function hasCriticalViolations(result: EvaluationResult): boolean {
  return result.violations.some((v) => v.severity === 'critical');
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
        displayName: 'Identify Role By',
        name: 'roleIdentifierType',
        type: 'options',
        default: 'id',
        options: [
          {
            name: 'Role ID (UUID)',
            value: 'id',
            description: 'Specify the role by its UUID',
          },
          {
            name: 'Role Name',
            value: 'name',
            description: 'Specify the role by its human-readable name',
          },
        ],
        description: 'How to identify the agent role to evaluate against',
      },
      {
        displayName: 'Role ID',
        name: 'roleId',
        type: 'string',
        default: '',
        required: true,
        placeholder: '747b0d54-3b89-48ab-b0d3-5f0f551630d6',
        displayOptions: {
          show: { roleIdentifierType: ['id'] },
        },
        description: 'The UUID of the Scopebound agent role to evaluate against',
      },
      {
        displayName: 'Role Name',
        name: 'roleName',
        type: 'string',
        default: '',
        required: true,
        placeholder: 'ap-processor',
        displayOptions: {
          show: { roleIdentifierType: ['name'] },
        },
        description: 'The human-readable name of the Scopebound agent role',
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
        description: 'Where the workflow definition to evaluate comes from',
      },
      {
        displayName: 'Workflow Field',
        name: 'workflowField',
        type: 'string',
        default: '',
        placeholder: 'workflow',
        displayOptions: {
          show: { workflowSource: ['inputJson'] },
        },
        description:
          'Optional. Name of the JSON field on each input item that contains the workflow definition. Leave empty to treat the entire input item as the workflow.',
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
        displayName: 'Workflow Format',
        name: 'sourceFormat',
        type: 'options',
        default: 'savant',
        options: [
          {
            name: 'n8n',
            value: 'n8n',
            description: 'Native n8n workflow export (server-side translator support is preview-only)',
          },
          {
            name: 'Canonical',
            value: 'savant',
            description: 'Scopebound canonical workflow shape — for hand-built workflow JSONs',
          },
          { name: 'Make', value: 'make', description: 'Make.com workflow export' },
          { name: 'Zapier', value: 'zapier', description: 'Zapier workflow export' },
        ],
        description:
          'Format of the workflow definition being evaluated. Canonical is the default supported path; n8n is preview.',
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
              'Always route to Pass output. Violations attached to item metadata as _scopebound. Safe default.',
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
        description: 'How the node responds to violations',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const credentials = await this.getCredentials('scopeboundApi');
    const apiKey = credentials.apiKey as string;
    const baseUrl = credentials.baseUrl as string;

    const roleIdentifierType = this.getNodeParameter('roleIdentifierType', 0, 'id') as 'id' | 'name';
    const roleId =
      roleIdentifierType === 'id'
        ? (this.getNodeParameter('roleId', 0) as string)
        : (this.getNodeParameter('roleName', 0) as string);
    const evaluationProfile = this.getNodeParameter('evaluationProfile', 0) as EvaluationProfile[];
    const workflowSource = this.getNodeParameter('workflowSource', 0) as 'inputJson' | 'parameter';
    const sourceFormat = this.getNodeParameter('sourceFormat', 0) as SourceFormat;
    const mode = this.getNodeParameter('mode', 0) as 'warn' | 'block' | 'throw';

    const inputItems = this.getInputData();

    // Single-parameter mode: evaluate one workflow, fan output to all items
    if (workflowSource === 'parameter') {
      const workflowRaw = this.getNodeParameter('workflowJson', 0) as
        | string
        | Record<string, unknown>;
      const workflow =
        typeof workflowRaw === 'string'
          ? (JSON.parse(workflowRaw) as Record<string, unknown>)
          : workflowRaw;

      const result = await evaluateOne(this, baseUrl, apiKey, {
        roleId,
        evaluationProfile,
        workflow: sourceFormat === 'savant' ? workflow : undefined,
        workflowRaw: sourceFormat !== 'savant' ? workflow : undefined,
        sourceFormat: sourceFormat !== 'savant' ? sourceFormat : undefined,
      });

      const enriched = inputItems.map((item, i) => ({
        json: { ...item.json, _scopebound: result },
        pairedItem: { item: i },
      }));

      if (mode === 'throw' && hasCriticalViolations(result)) {
        throw new NodeOperationError(
          this.getNode(),
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

    // Per-item mode: extract workflow from each input item, evaluate independently
    const workflowField = this.getNodeParameter('workflowField', 0, '') as string;
    const passOut: INodeExecutionData[] = [];
    const failOut: INodeExecutionData[] = [];

    for (let i = 0; i < inputItems.length; i++) {
      const item = inputItems[i];
      const workflow = workflowField
        ? ((item.json as Record<string, unknown>)[workflowField] as
            | Record<string, unknown>
            | undefined)
        : (item.json as Record<string, unknown>);

      if (!workflow || Object.keys(workflow).length === 0) {
        throw new NodeOperationError(
          this.getNode(),
          workflowField
            ? `Input item ${i} has no workflow definition at field "${workflowField}"`
            : `Input item ${i} is empty — cannot evaluate`,
          { itemIndex: i },
        );
      }

      const result = await evaluateOne(this, baseUrl, apiKey, {
        roleId,
        evaluationProfile,
        workflow: sourceFormat === 'savant' ? workflow : undefined,
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
