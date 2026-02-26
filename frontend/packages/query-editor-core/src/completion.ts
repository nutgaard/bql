import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import type { CompletionRequest, CompletionResponse, QueryLanguageSpec } from "./types";
import { buildCompletionRequest } from "./analysis";

export type CompletionCallback = (req: CompletionRequest) => Promise<CompletionResponse>;

export function createCompletionSource(config: {
  languageSpec: QueryLanguageSpec;
  grammarVersion: string;
  complete?: CompletionCallback;
}) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_.-]*/);
    const query = context.state.doc.toString();
    const pos = context.pos;
    const staticItems = inferStaticCompletions(query, pos, config.languageSpec);

    let callbackItems: Completion[] = [];
    if (config.complete) {
      try {
        const response = await config.complete(
          buildCompletionRequest(query, pos, config.grammarVersion, config.languageSpec.version)
        );
        callbackItems = response.items.map((item) => ({
          label: item.label,
          type: item.type,
          detail: item.detail,
          apply: item.apply
        }));
      } catch {
        callbackItems = [];
      }
    }

    const options = dedupeCompletions([...staticItems, ...callbackItems]);
    if (options.length === 0) {
      return null;
    }

    const from = word ? word.from : pos;
    return {
      from,
      options,
      validFor: /^[A-Za-z0-9_.-]*$/
    };
  };
}

function inferStaticCompletions(query: string, pos: number, spec: QueryLanguageSpec): Completion[] {
  const before = query.slice(0, pos);
  const trimmed = before.replace(/\s+$/, "");
  const lastToken = trimmed.split(/\s+/).at(-1) ?? "";
  const prevChar = trimmed.at(-1);

  if (trimmed.length === 0 || prevChar === "(" || /(?:AND|OR|NOT)$/.test(trimmed)) {
    return [
      ...spec.fields.map((field) => ({ label: field.name, type: "variable" })),
      { label: "NOT", type: "keyword" }
    ];
  }

  const fieldNames = new Set(spec.fields.map((f) => f.name));
  if (fieldNames.has(lastToken)) {
    const field = spec.fields.find((f) => f.name === lastToken);
    const operators = field?.operators ?? spec.operatorsByType[field?.type ?? "string"] ?? [];
    return operators.map((op) => ({ label: op, type: "operator" }));
  }

  if (/^(=|!=|>|>=|<|<=|IN)$/.test(lastToken) || /NOT\s+IN$/.test(trimmed)) {
    return valueCompletions(spec);
  }

  return [
    { label: "AND", type: "keyword" },
    { label: "OR", type: "keyword" },
    { label: "IN", type: "operator" },
    ...spec.fields.map((field) => ({ label: field.name, type: "variable" }))
  ];
}

function valueCompletions(spec: QueryLanguageSpec): Completion[] {
  const values: Completion[] = [
    { label: '""', apply: '""', type: "text", detail: "string" },
    { label: "true", type: "constant" },
    { label: "false", type: "constant" },
    { label: "(", type: "text", detail: "start list" }
  ];

  for (const field of spec.fields) {
    for (const enumValue of field.enumValues ?? []) {
      values.push({ label: `\"${enumValue}\"`, type: "constant", detail: `${field.name} enum` });
    }
  }

  return dedupeCompletions(values);
}

function dedupeCompletions(items: Completion[]): Completion[] {
  const seen = new Set<string>();
  const result: Completion[] = [];
  for (const item of items) {
    const key = `${item.label}:${item.type ?? ""}:${item.apply ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}
