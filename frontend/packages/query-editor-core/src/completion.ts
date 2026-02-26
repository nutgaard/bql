import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import type { EditorState } from "@codemirror/state";
import { buildCompletionRequest } from "./analysis";
import { inferCompletionSyntaxContext } from "./completion-syntax";
import type { CompletionRequest, CompletionResponse, QueryLanguageSpec } from "./types";

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
    const plan = inferStaticCompletionPlan(context.state, query, pos, config.languageSpec);

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

    let options = dedupeCompletions([...plan.staticItems, ...callbackItems]);
    if (plan.labelPrefixFilter) {
      options = filterCompletionsByLabelPrefix(options, plan.labelPrefixFilter);
    }
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

type StaticCompletionPlan = {
  staticItems: Completion[];
  labelPrefixFilter?: string;
};

function inferStaticCompletionPlan(
  state: EditorState,
  query: string,
  pos: number,
  spec: QueryLanguageSpec
): StaticCompletionPlan {
  const syntaxContext = inferCompletionSyntaxContext({ state, query, pos, spec });

  switch (syntaxContext.kind) {
    case "inListValueStart":
      return { staticItems: scalarValueCompletions(spec, syntaxContext.fieldName) };
    case "clauseStart":
      return { staticItems: clauseStartCompletions(spec) };
    case "afterNot":
      return { staticItems: afterNotCompletions(spec) };
    case "afterField":
      return { staticItems: operatorCompletions(spec, syntaxContext.fieldName) };
    case "partialClauseStart":
      return {
        staticItems: clauseStartCompletions(spec),
        labelPrefixFilter: syntaxContext.prefix
      };
    case "partialAfterNot":
      return {
        staticItems: afterNotCompletions(spec),
        labelPrefixFilter: syntaxContext.prefix
      };
    case "afterInOperator":
      return { staticItems: [{ label: "(", type: "text", detail: "start list" }] };
    case "afterCompareOperator":
      return { staticItems: scalarValueCompletions(spec, syntaxContext.fieldName) };
    case "clauseBoundary":
      return {
        staticItems: [
          { label: "AND", type: "keyword" },
          { label: "OR", type: "keyword" }
        ]
      };
    case "fallback":
      return { staticItems: fallbackCompletions(spec) };
  }
}

function operatorCompletions(spec: QueryLanguageSpec, fieldName: string): Completion[] {
  const field = spec.fields.find((candidate) => candidate.name === fieldName);
  const operators = field?.operators ?? spec.operatorsByType[field?.type ?? "string"] ?? [];
  return operators.map((op) => ({ label: op, type: "operator" }));
}

function scalarValueCompletions(spec: QueryLanguageSpec, fieldName?: string): Completion[] {
  const field = fieldName ? spec.fields.find((candidate) => candidate.name === fieldName) : undefined;
  if (!field) {
    return [];
  }

  if (field.enumValues && field.enumValues.length > 0) {
    return field.enumValues.map((enumValue) => ({
      label: `\"${enumValue}\"`,
      type: "constant",
      detail: `${field.name} enum`
    }));
  }

  switch (field.type) {
    case "boolean":
      return [
        { label: "true", type: "constant" },
        { label: "false", type: "constant" }
      ];
    case "string":
      return [{ label: '""', apply: '""', type: "text", detail: "string" }];
    case "number":
      return [{ label: "0", type: "constant", detail: "number" }];
  }
}

function macroAliasCompletions(spec: QueryLanguageSpec): Completion[] {
  return (spec.functions ?? []).map((fn) => ({
    label: `${fn.name}()`,
    type: "function",
    detail: fn.detail ?? "macro alias"
  }));
}

function clauseStartCompletions(spec: QueryLanguageSpec): Completion[] {
  return [
    ...spec.fields.map((field) => ({ label: field.name, type: "variable" })),
    ...macroAliasCompletions(spec),
    { label: "NOT", type: "keyword" }
  ];
}

function afterNotCompletions(spec: QueryLanguageSpec): Completion[] {
  return [
    { label: "(", type: "text", detail: "start group" },
    ...spec.fields
      .filter((field) => field.type === "boolean")
      .map((field) => ({ label: field.name, type: "variable" })),
    ...macroAliasCompletions(spec)
  ];
}

function fallbackCompletions(spec: QueryLanguageSpec): Completion[] {
  return [
    { label: "AND", type: "keyword" },
    { label: "OR", type: "keyword" },
    { label: "IN", type: "operator" },
    ...spec.fields.map((field) => ({ label: field.name, type: "variable" }))
  ];
}

function filterCompletionsByLabelPrefix(items: Completion[], prefix: string): Completion[] {
  return items
    .filter((item) => item.label.startsWith(prefix))
    .sort((a, b) => a.label.localeCompare(b.label));
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
