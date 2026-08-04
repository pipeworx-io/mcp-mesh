# mcp-mesh

NLM MeSH (Medical Subject Headings) MCP.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `search_descriptors` | Search NLM MeSH descriptors by a disease/drug/concept term (e.g. "diabetes", "aspirin", "myocardial infarction"). Returns the matching MeSH descriptor IDs (Dxxxxxxx) — the controlled-vocabulary headings used to index PubMed. The core free-text-to-MeSH lookup. Keyless. |
| `get_descriptor` | Get full detail for a MeSH descriptor by its ID (e.g. "D003920" = Diabetes Mellitus): its preferred label, entry terms (synonyms MeSH indexes under it), allowable qualifiers (subheadings like "drug therapy", "epidemiology"), and related see-also headings. Keyless. |
| `resolve_term` | Map a free-text term or everyday synonym to its canonical MeSH descriptor(s) — the preferred heading to use when searching PubMed. Tries an exact descriptor match first; if none, falls back to a fuzzy contains match (flagged fuzzy). Keyless. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "mesh": {
      "url": "https://gateway.pipeworx.io/mesh/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Mesh data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
