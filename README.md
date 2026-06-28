# n8n-nodes-scopebound

[![npm version](https://img.shields.io/npm/v/@scopebound/n8n-nodes-scopebound/preview.svg)](https://www.npmjs.com/package/@scopebound/n8n-nodes-scopebound)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Official [Scopebound](https://scopebound.ai) community node for [n8n](https://n8n.io). Validates AI agent workflows against role-based authorization scopes **before** they run — catching credential misuse, out-of-scope tool calls, and compliance violations at design time rather than at the audit.

## What it does

The **Scopebound Scope Check** node sits anywhere in your n8n workflow and evaluates a workflow definition (n8n format, or the canonical Scopebound shape) against a Scopebound agent role. The evaluation runs server-side via the [Scopebound API](https://scopebound.ai) and returns:

- A pass/fail verdict per compliance profile (SOC1, SOC2 Type II, Production Readiness, HIPAA)
- Violations with codes, severities, and offending node IDs
- A cryptographically signed attestation token suitable for audit retention

The node routes items to a **Pass** or **Fail** output based on the result, and supports three modes: *warn only*, *block on critical*, or *throw on critical*.

## Installation

### Via n8n Community Nodes (recommended)

1. In your n8n instance, go to **Settings → Community Nodes**
2. Click **Install a community node**
3. Enter `@scopebound/n8n-nodes-scopebound` and confirm
4. Reload n8n; the **Scopebound Scope Check** node will appear in the node picker

### Manual installation (self-hosted n8n)

```bash
# In your n8n custom nodes directory (typically ~/.n8n/nodes/)
npm install @scopebound/n8n-nodes-scopebound
```

Restart your n8n instance after installation.

## Credentials

The node requires a **Scopebound API** credential. To create one:

1. In n8n, click **Credentials → New → Scopebound API**
2. Enter your **API Key** (obtainable from your Scopebound partner workspace)
3. Enter the **Base URL** of your Scopebound enforcement plane (e.g. `https://api.scopebound.ai`, or a self-hosted URL)
4. Save

Don't have a Scopebound API key yet? Request access at [scopebound.ai](https://scopebound.ai).

## Usage

### Workflow formats

The Scopebound node supports two workflow formats. The format must match the shape of your input data.

**`n8n` — for n8n users (recommended)**

A native n8n workflow export. This is the format you get when you export a workflow from n8n's UI (top-right menu → Download). Example:

```json
{
  "name": "your-workflow",
  "nodes": [
    {"id": "a", "name": "Manual Trigger", "type": "n8n-nodes-base.manualTrigger", "typeVersion": 1, "position": [0, 0], "parameters": {}}
  ],
  "connections": {
    "Manual Trigger": {"main": [[{"node": "...", "type": "main", "index": 0}]]}
  }
}
```

**`Canonical` — for hand-built or non-n8n workflow definitions**

Scopebound's native workflow shape. Use this when you're building workflow definitions manually or evaluating workflows from a non-n8n source. Example:

```json
{
  "workflowId": "demo",
  "nodes": [
    {"id": "src", "type": "source", "tool": "manual_trigger"},
    {"id": "dst", "type": "destination", "tool": "post_to_erp", "credentials": ["sap-prod-api"]}
  ],
  "edges": [{"from": "src", "to": "dst"}]
}
```

> ⚠️ Set the **Workflow Format** dropdown to match the shape of your input data. If you set the format to `n8n` but provide Canonical-shape data (or vice versa), the server will reject the request with a translator error.

Example workflows for both formats are in [`examples/`](examples/).

Drop the **Scopebound Scope Check** node into any workflow where you have a workflow definition you want to validate. The node configures with these parameters:

| Parameter | Description |
|---|---|
| **Identify Role By** | Choose whether to specify the agent role by UUID or by name |
| **Role ID** / **Role Name** | The role to evaluate against |
| **Evaluation Profile** | One or more compliance profiles: SOC1, SOC2 Type II, Production Readiness, HIPAA |
| **Workflow Source** | Where the workflow definition comes from: an input field, or a JSON parameter |
| **Workflow Field** | (optional) Name of the JSON field on each input item containing the workflow. Leave blank to treat the whole input item as the workflow. |
| **Workflow Format** | Format of the workflow data: `n8n` (native n8n export), `Canonical` (Scopebound's native shape), `Make`, or `Zapier` |
| **Mode** | `Warn Only` (always pass), `Block on Critical` (route critical violations to Fail), or `Throw on Critical` (halt the workflow) |

The output of every item is enriched with a `_scopebound` field containing the full evaluation result (verdict, violations, attestation token).

### Example workflow

```
Manual Trigger
    ↓
Edit Fields (Set)   — outputs an n8n workflow JSON to evaluate
    ↓
Scopebound Scope Check   — validates it against role "ap-processor"
    ├── Pass → continue downstream processing
    └── Fail → notify on Slack, log to audit, or halt
```

A working example JSON is in [`examples/workflow-lint.json`](examples/workflow-lint.json) in this repository.

## Compatibility

- n8n **v2.0** and above (uses `n8nNodesApiVersion: 1`)
- Node.js **20.15** or later
- Works in self-hosted, n8n Cloud, and Desktop environments

## Resources

- [**Full documentation for this node**](https://docs.scopebound.ai/sdk/n8n) — installation, configuration, workflow formats, troubleshooting
- [Scopebound documentation home](https://docs.scopebound.ai) — quickstart, framework guides, API reference
- [Scopebound API reference](https://docs.scopebound.ai/api/reference/)
- [TypeScript SDK](https://docs.scopebound.ai/sdk/typescript) — code-level integration
- [Example workflows](https://github.com/scopebound-ai/n8n-nodes-scopebound/tree/main/examples)
- [Report an issue](https://github.com/scopebound-ai/n8n-nodes-scopebound/issues)

## Version history

### 0.1.0-preview

- Initial preview release
- Scopebound Scope Check node with Role ID / Role Name identification
- Four evaluation profiles, three operating modes
- Pass/Fail output routing
- Supports n8n, Canonical (Scopebound), Make, and Zapier workflow formats

## License

[MIT](LICENSE) © Scopebound
