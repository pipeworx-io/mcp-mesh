interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * NLM MeSH (Medical Subject Headings) MCP.
 *
 * Keyless RDF lookup against id.nlm.nih.gov/mesh — resolve free-text
 * biomedical terms (diseases, drugs, concepts) to MeSH descriptors, the
 * controlled vocabulary NLM uses to index PubMed. Map everyday synonyms to
 * canonical MeSH headings for precise literature searching.
 */


const BASE = 'https://id.nlm.nih.gov/mesh';
const UA = 'pipeworx/1.0 (+https://pipeworx.io)';

/** Last path segment of a MeSH resource URL, e.g. ".../D003920" -> "D003920". */
function meshId(resource: unknown): string {
  if (typeof resource !== 'string') return '';
  const trimmed = resource.replace(/\/+$/, '');
  const seg = trimmed.split('/').pop() ?? '';
  return seg;
}

/** GET against the MeSH lookup API, returning parsed JSON or throwing. */
async function meshGet(path: string, params: Record<string, string | number | undefined>): Promise<unknown> {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
  const url = `${BASE}${path}${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA } });
  if (!res.ok) throw new Error(`MeSH: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const MATCH_VALUES = ['exact', 'contains', 'startswith'] as const;
function normMatch(v: unknown, fallback: string): string {
  return typeof v === 'string' && (MATCH_VALUES as readonly string[]).includes(v) ? v : fallback;
}
function normLimit(v: unknown, def: number, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(Math.floor(n), max);
}

const tools: McpToolExport['tools'] = [
  {
    name: 'search_descriptors',
    description:
      'Search NLM MeSH descriptors by a disease/drug/concept term (e.g. "diabetes", "aspirin", "myocardial infarction"). Returns the matching MeSH descriptor IDs (Dxxxxxxx) — the controlled-vocabulary headings used to index PubMed. The core free-text-to-MeSH lookup. Keyless.',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'A disease, drug, or biomedical concept term, e.g. "diabetes", "aspirin", "myocardial infarction".',
        },
        match: {
          type: 'string',
          description: 'Match mode against descriptor labels: "exact", "contains", or "startswith". Default "contains".',
        },
        limit: { type: 'number', description: 'Max results (default 10, max 25).' },
      },
      required: ['text'],
    },
  },
  {
    name: 'get_descriptor',
    description:
      'Get full detail for a MeSH descriptor by its ID (e.g. "D003920" = Diabetes Mellitus): its preferred label, entry terms (synonyms MeSH indexes under it), allowable qualifiers (subheadings like "drug therapy", "epidemiology"), and related see-also headings. Keyless.',
    inputSchema: {
      type: 'object',
      properties: {
        mesh_id: {
          type: 'string',
          description: 'A MeSH descriptor ID, e.g. "D003920" (Diabetes Mellitus) or "D001241" (Aspirin).',
        },
      },
      required: ['mesh_id'],
    },
  },
  {
    name: 'resolve_term',
    description:
      'Map a free-text term or everyday synonym to its canonical MeSH descriptor(s) — the preferred heading to use when searching PubMed. Tries an exact descriptor match first; if none, falls back to a fuzzy contains match (flagged fuzzy). Keyless.',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'A term or synonym to canonicalize, e.g. "aspirin", "high blood pressure", "diabetes".',
        },
        limit: { type: 'number', description: 'Max matches (default 10, max 25).' },
      },
      required: ['text'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    switch (name) {
      case 'search_descriptors':
        return searchDescriptors(args);
      case 'get_descriptor':
        return getDescriptor(args);
      case 'resolve_term':
        return resolveTerm(args);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

type LabeledResource = { resource?: unknown; label?: unknown };

async function searchDescriptors(args: Record<string, unknown>): Promise<unknown> {
  const text = typeof args.text === 'string' ? args.text.trim() : '';
  if (!text) return { error: 'provide a term in "text"', text: args.text ?? null };
  const match = normMatch(args.match, 'contains');
  const limit = normLimit(args.limit, 10, 25);

  const arr = (await meshGet('/lookup/descriptor', { label: text, match, limit })) as LabeledResource[];
  const list = Array.isArray(arr) ? arr : [];
  return {
    count: list.length,
    descriptors: list.map((d) => ({
      mesh_id: meshId(d.resource),
      label: d.label,
      url: d.resource,
    })),
  };
}

async function getDescriptor(args: Record<string, unknown>): Promise<unknown> {
  const id = typeof args.mesh_id === 'string' ? args.mesh_id.trim() : '';
  if (!id) return { error: 'provide a descriptor id in "mesh_id"', mesh_id: args.mesh_id ?? null };

  const d = (await meshGet('/lookup/details', { descriptor: id })) as Record<string, unknown>;
  const terms = (Array.isArray(d.terms) ? d.terms : []) as LabeledResource[];
  const qualifiers = (Array.isArray(d.qualifiers) ? d.qualifiers : []) as LabeledResource[];
  // see-also key casing is lowercase "seealso" in the live API; accept both defensively.
  const seeRaw = (Array.isArray(d.seealso) ? d.seealso : Array.isArray((d as any).seeAlso) ? (d as any).seeAlso : []) as LabeledResource[];

  // The descriptor's label comes from its preferred entry term.
  const preferred = terms.find((t) => (t as Record<string, unknown>).preferred === true) ?? terms[0];

  return {
    mesh_id: meshId(d.descriptor),
    label: preferred ? preferred.label : null,
    entry_terms: terms
      .map((t) => t.label)
      .filter((l): l is string => typeof l === 'string')
      .slice(0, 25),
    qualifiers: qualifiers.map((q) => ({ id: meshId(q.resource), label: q.label })),
    see_also: seeRaw.map((s) => ({ id: meshId(s.resource), label: s.label })),
  };
}

async function resolveTerm(args: Record<string, unknown>): Promise<unknown> {
  const text = typeof args.text === 'string' ? args.text.trim() : '';
  if (!text) return { error: 'provide a term in "text"', text: args.text ?? null };
  const limit = normLimit(args.limit, 10, 25);

  const toMatches = (arr: unknown) =>
    (Array.isArray(arr) ? (arr as LabeledResource[]) : []).map((d) => ({
      mesh_id: meshId(d.resource),
      label: d.label,
      url: d.resource,
    }));

  // Primary: a synonym often exact-matches a descriptor's preferred label.
  const exact = toMatches(await meshGet('/lookup/descriptor', { label: text, match: 'exact', limit }));
  if (exact.length > 0) {
    return { query: text, matches: exact };
  }

  // Fallback: fuzzy contains match.
  const fuzzy = toMatches(await meshGet('/lookup/descriptor', { label: text, match: 'contains', limit }));
  return { query: text, fuzzy: true, matches: fuzzy };
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
