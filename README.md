# @scopebound/n8n-nodes-scopebound

Official n8n community node for [Scopebound](https://scopebound.ai) — pre-execution scope enforcement for AI agent workflows.

> **v0.1.0-preview** — Preview release. APIs may change before v1.0.

## What it does

Adds a **Scopebound Scope Check** node to n8n that validates workflow definitions against agent role authorization scope before execution. Use it to:

- Gate workflows in CI/CD-style n8n pipelines
- Pre-validate AI agent workflows passed through n8n as data
- Run compliance checks against SOC1, SOC2 Type II, PRODUCTION_READINESS, or HIPAA profiles
- Issue signed attestation tokens that compliance teams can verify offline

The node communicates with the Scopebound enforcement plane via the [@scopebound/sdk](https://www.npmjs.com/package/@scopebound/sdk) TypeScript client.

## Install

In your n8n instance:

**Settings → Community Nodes → Install** → enter package name:

```
@scopebound/n8n-nodes-scopebound
```

Or via npm in a self-hosted n8n:

```bash
cd ~/.n8n/nodes
npm install @scopebound/n8n-nodes-scopebound@preview
```

Restart n8n. The "Scopebound Scope Check" node appears in the node picker.

## Configure credentials

**Credentials → New → Scopebound API**:

| Field   | Value                                                                  |
| ------- | ---------------------------------------------------------------------- |
| API Key | Your Scopebound API key (starts with `sb-`)                            |
| Base URL| `https://api.scopebound.ai` (or `http://localhost:8080` for local dev) |

## Use the node

Drop the **Scopebound Scope Check** node into any workflow. Configure:

| Property            | Description                                                          |
| ------------------- | -------------------------------------------------------------------- |
| Role ID             | The agent role to evaluate against (UUID or name)                    |
| Evaluation Profile  | Which compliance profiles to run (multi-select)                      |
| Workflow Source     | Read from input field, or paste a workflow as parameter              |
| Source Format       | Savant (canonical), n8n, Make, Zapier                                |
| Mode                | Warn Only (default), Block on Critical, Throw on Critical            |

### Mode behavior

- **Warn Only** (default): All items pass through to the "Pass" output. Evaluation result is attached to each item at `_scopebound`. Use for observability without blocking.
- **Block on Critical Violations**: Items with critical violations are routed to the "Fail" output. Non-critical violations still pass.
- **Throw on Critical Violations**: The workflow halts with an error when critical violations occur. Use when you want hard failure semantics.

### Example output (Warn mode)

Each item passes through with evaluation metadata attached:

```json
{
  "workflow": { ... your original data ... },
  "_scopebound": {
    "evaluationId": "eval_abc123",
    "workflowHash": "...",
    "soc1Status": "pass",
    "productionReadinessStatus": "fail",
    "violations": [
      {
        "nodeId": "post",
        "code": "SB-SCOPE-003",
        "severity": "critical",
        "message": "Node 'post' references credential 'sap-prod-api' which is not in role allowed_credentials",
        "control": "SB-SCOPE-003",
        "layer": 1
      }
    ],
    "warnings": [],
    "attestationToken": null
  }
}
```

The `attestationToken` is only present when no critical violations were found — a JWT signed by Scopebound that auditors can verify offline.

## Common patterns

### Validate an externally-received workflow before activating

```
[Webhook (workflow received)] → [Scopebound Scope Check (block mode)] → [Activate Workflow]
                                                            ↓ fail
                                                [Notify (rejected for compliance reasons)]
```

### Audit logging on every executed workflow

```
[Workflow Trigger] → [Scopebound Scope Check (warn mode)] → [Original workflow logic]
                                              ↓
                            [Send to audit ledger / SIEM]
```

### Run evaluation on n8n workflows from disk for CI

```
[Read Binary File (workflow.json)] → [Scopebound Scope Check (source format=n8n, throw mode)] → [Pass]
```

Workflow fails the n8n pipeline if violations exist — useful for "lint your workflows" CI.

## Development

```bash
git clone https://github.com/scopebound-ai/n8n-nodes-scopebound.git
cd n8n-nodes-scopebound
npm install
npm run build
```

To test against your local n8n:

```bash
# Link the node package
cd ~/.n8n/nodes
npm install /path/to/your/n8n-nodes-scopebound

# Restart n8n
```

## Roadmap

- Post-execution audit logging node (record actual tool calls + results to Scopebound ledger)
- Role discovery node (dropdown of available roles from your Scopebound workspace)
- Attestation Token Verify node (offline JWT verification against platform public key)
- Approval workflow integration (request human approval when role requires it)
- Workflow translator inspection (preview what Scopebound's translator would produce from an n8n workflow without running an evaluation)

## License

Apache 2.0
