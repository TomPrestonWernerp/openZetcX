---
name: coze-kb-search
description: "Call a Coze workflow to search an environmental assessment knowledge base. Trigger for questions about EIA, environmental impact reports, construction project environmental approval, EIA technical guidelines, pollutant-impact projects, EIA category management, approval procedures, registration forms, pollutant permits, and ecology or environmental compliance."
---

# Coze Knowledge Base Search

Use this skill when the user asks professional questions about environmental impact assessment or project approval policy and wants an answer grounded in the organization's knowledge base.

## Workflow

- Endpoint: `https://api.coze.cn/v1/workflow/stream_run`
- Method: `POST`
- Workflow ID: set this to your published Coze workflow id.
- Input parameter: `input`
- Token: keep it outside the plugin package. Use a local secret, environment variable, or private deployment setting.

## Request Shape

```json
{
  "workflow_id": "YOUR_WORKFLOW_ID",
  "parameters": {
    "input": "user question"
  }
}
```

## Response Handling

The Coze API may return Server-Sent Events. Parse `data`, then parse the nested `content` JSON. The useful result usually looks like:

```json
{
  "output": [
    {
      "documentId": "source document id",
      "output": "matched knowledge-base passage"
    }
  ]
}
```

## Answer Style

1. Start with a concise answer.
2. List the most relevant retrieved passages.
3. Include `documentId` when available.
4. If the returned result is empty, say that the knowledge base did not return a matching passage and suggest checking the query or workflow configuration.

## Security Notes

- Never publish Coze PAT tokens in this repository.
- Rotate tokens if they were ever shared in screenshots, logs, or committed files.
- Prefer a backend proxy or local secret store for production use.
