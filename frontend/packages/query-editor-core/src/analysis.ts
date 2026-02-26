import type { SyntaxNode } from "@lezer/common";
import { bqlParser } from "@bql/query-language-lezer";
import type {
  CompletionRequest,
  MacroAliasSpec,
  QueryAstEnvelope,
  QueryAstNode,
  QueryDiagnostic,
  QueryLanguageSpec,
  SourceSpan,
  ListNode,
  LiteralNode,
  ValueNode
} from "./types";

export type AnalyzeQueryOptions = {
  astVersion: string;
  grammarVersion: string;
  languageSpec: QueryLanguageSpec;
};

export type QueryAnalysis = {
  syntaxDiagnostics: QueryDiagnostic[];
  ast: QueryAstEnvelope | null;
};

const MAX_MACRO_EXPANSION_DEPTH = 10;

class AstBuildDiagnosticError extends Error {
  constructor(
    readonly diagnosticCode: QueryDiagnostic["code"],
    message: string,
    readonly span: SourceSpan
  ) {
    super(message);
    this.name = "AstBuildDiagnosticError";
  }
}

type AstBuildContext = {
  languageSpec: QueryLanguageSpec;
  macroAliases: Map<string, MacroAliasSpec>;
  macroStack: string[];
  macroDepth: number;
};

export function analyzeQuery(input: string, options: AnalyzeQueryOptions): QueryAnalysis {
  const tree = bqlParser.parse(input);
  const syntaxDiagnostics = collectSyntaxDiagnostics(tree.topNode, input);
  if (syntaxDiagnostics.length > 0) {
    return { syntaxDiagnostics, ast: null };
  }

  try {
    const buildContext = createAstBuildContext(options.languageSpec, input);
    const root = buildAstFromQuery(tree.topNode, input, buildContext);
    const stats = computeAstStats(root);
    const ast: QueryAstEnvelope = {
      astVersion: options.astVersion,
      grammarVersion: options.grammarVersion,
      source: { rawQuery: input },
      root,
      metadata: {
        parser: "lezer",
        nodeCount: stats.nodeCount,
        maxDepth: stats.maxDepth
      }
    };
    return { syntaxDiagnostics: [], ast };
  } catch (error) {
    if (error instanceof AstBuildDiagnosticError) {
      return {
        syntaxDiagnostics: [
          {
            severity: "error",
            code: error.diagnosticCode,
            message: error.message,
            from: error.span.from,
            to: error.span.to,
            source: "syntax"
          }
        ],
        ast: null
      };
    }
    return {
      syntaxDiagnostics: [
        {
          severity: "error",
          code: "AST_BUILD_FAILED",
          message: error instanceof Error ? error.message : "Failed to build AST",
          from: 0,
          to: Math.max(1, input.length),
          source: "syntax"
        }
      ],
      ast: null
    };
  }
}

function createAstBuildContext(languageSpec: QueryLanguageSpec, input: string): AstBuildContext {
  return {
    languageSpec,
    macroAliases: buildMacroAliasIndex(languageSpec, input),
    macroStack: [],
    macroDepth: 0
  };
}

function buildMacroAliasIndex(languageSpec: QueryLanguageSpec, input: string): Map<string, MacroAliasSpec> {
  const aliases = new Map<string, MacroAliasSpec>();
  for (const fn of languageSpec.functions ?? []) {
    const existing = aliases.get(fn.name);
    if (existing) {
      throw new AstBuildDiagnosticError(
        "DUPLICATE_MACRO_ALIAS",
        `Duplicate macro alias '${fn.name}'`,
        { from: 0, to: Math.max(1, input.length) }
      );
    }
    aliases.set(fn.name, fn);
  }
  return aliases;
}

function collectSyntaxDiagnostics(node: SyntaxNode, input: string): QueryDiagnostic[] {
  const diagnostics: QueryDiagnostic[] = [];
  visit(node, (current) => {
    if (current.type.isError) {
      diagnostics.push({
        severity: "error",
        code: "SYNTAX_ERROR",
        message: "Invalid query syntax",
        from: current.from,
        to: Math.max(current.from + 1, current.to),
        source: "syntax"
      });
    }
  });

  if (node.to < input.length) {
    diagnostics.push({
      severity: "error",
      code: "UNPARSED_TRAILING_INPUT",
      message: "Trailing input could not be parsed",
      from: node.to,
      to: input.length,
      source: "syntax"
    });
  }

  return mergeOverlappingDiagnostics(diagnostics);
}

function mergeOverlappingDiagnostics(diagnostics: QueryDiagnostic[]): QueryDiagnostic[] {
  const sorted = [...diagnostics].sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: QueryDiagnostic[] = [];
  for (const diagnostic of sorted) {
    const last = merged.at(-1);
    if (last && diagnostic.from <= last.to) {
      last.to = Math.max(last.to, diagnostic.to);
      continue;
    }
    merged.push({ ...diagnostic });
  }
  return merged;
}

function visit(node: SyntaxNode, fn: (node: SyntaxNode) => void): void {
  fn(node);
  for (let child = node.firstChild; child; child = child.nextSibling) {
    visit(child, fn);
  }
}

function buildAstFromQuery(queryNode: SyntaxNode, input: string, context: AstBuildContext): QueryAstNode {
  const expression = queryNode.getChild("Expression") ?? queryNode.firstChild;
  if (!expression) {
    throw new Error("Missing Expression node");
  }
  return buildExpression(expression, input, context);
}

function buildExpression(node: SyntaxNode, input: string, context: AstBuildContext): QueryAstNode {
  switch (node.name) {
    case "Expression":
      return buildExpression(expectChild(node, ["OrExpression"]), input, context);
    case "OrExpression": {
      const terms = node.getChildren("AndExpression").map((child) => buildExpression(child, input, context));
      return foldLogical(node, terms, "OR");
    }
    case "AndExpression": {
      const terms = node.getChildren("NotExpression").map((child) => buildExpression(child, input, context));
      return foldLogical(node, terms, "AND");
    }
    case "NotExpression": {
      const hasNot = Boolean(node.getChild("NotOp"));
      if (hasNot) {
        const primary = expectChild(node, ["Primary"]);
        return {
          kind: "not",
          expression: buildExpression(primary, input, context),
          span: spanOf(node)
        };
      }
      return buildExpression(expectChild(node, ["Primary"]), input, context);
    }
    case "Primary": {
      const comparison = node.getChild("Comparison");
      if (comparison) {
        return buildExpression(comparison, input, context);
      }
      const macroCall = node.getChild("MacroCall");
      if (macroCall) {
        return buildExpression(macroCall, input, context);
      }
      const group = node.getChild("Group");
      if (group) {
        return buildExpression(expectChild(group, ["Expression"]), input, context);
      }
      break;
    }
    case "MacroCall":
      return expandMacroAlias(node, input, context);
    case "Comparison": {
      const fieldNode = expectChild(node, ["Field"]);
      const fieldName = textOf(expectChild(fieldNode, ["Identifier"]), input);
      const fieldRef = {
        kind: "fieldRef" as const,
        name: fieldName,
        span: spanOf(fieldNode)
      };
      const compareOperator = node.getChild("CompareOperator");
      if (compareOperator) {
        const scalar = expectChild(node, ["ScalarValue"]);
        return {
          kind: "comparison",
          field: fieldRef,
          operator: textOf(compareOperator, input).trim(),
          value: buildScalarValue(scalar, input),
          span: spanOf(node)
        };
      }
      const inOperator = node.getChild("InOperator");
      if (inOperator) {
        const listLiteral = expectChild(node, ["ListLiteral"]);
        return {
          kind: "comparison",
          field: fieldRef,
          operator: normalizeSpace(textOf(inOperator, input)),
          value: buildListValue(listLiteral, input),
          span: spanOf(node)
        };
      }

      const fieldSpec = context.languageSpec.fields.find((field) => field.name === fieldName);
      if (fieldSpec?.type !== "boolean") {
        throw new AstBuildDiagnosticError(
          "INVALID_BOOLEAN_FIELD_SHORTHAND",
          `Boolean shorthand is only supported for boolean fields (got '${fieldName}')`,
          spanOf(fieldNode)
        );
      }

      return {
        kind: "comparison",
        field: fieldRef,
        operator: "=",
        value: {
          kind: "booleanLiteral",
          value: true,
          span: spanOf(fieldNode)
        },
        span: spanOf(node)
      };
    }
  }

  throw new Error(`Unsupported node while building AST: ${node.name}`);
}

function expandMacroAlias(node: SyntaxNode, input: string, context: AstBuildContext): QueryAstNode {
  const macroSpan = spanOf(node);
  const identifier = expectChild(node, ["Identifier"]);
  const name = textOf(identifier, input);
  const alias = context.macroAliases.get(name);

  if (!alias) {
    throw new AstBuildDiagnosticError("UNKNOWN_MACRO_ALIAS", `Unknown macro alias '${name}'`, macroSpan);
  }

  if (context.macroStack.includes(name)) {
    throw new AstBuildDiagnosticError(
      "MACRO_EXPANSION_CYCLE",
      `Macro alias cycle detected: ${[...context.macroStack, name].join(" -> ")}`,
      macroSpan
    );
  }

  if (context.macroDepth >= MAX_MACRO_EXPANSION_DEPTH) {
    throw new AstBuildDiagnosticError(
      "MACRO_EXPANSION_DEPTH_EXCEEDED",
      `Macro alias expansion depth exceeded (${MAX_MACRO_EXPANSION_DEPTH})`,
      macroSpan
    );
  }

  const expansionTree = bqlParser.parse(alias.expansion);
  const expansionDiagnostics = collectSyntaxDiagnostics(expansionTree.topNode, alias.expansion);
  if (expansionDiagnostics.length > 0) {
    throw new AstBuildDiagnosticError(
      "INVALID_MACRO_EXPANSION",
      `Invalid macro expansion for '${name}'`,
      macroSpan
    );
  }

  const expanded = buildAstFromQuery(expansionTree.topNode, alias.expansion, {
    ...context,
    macroStack: [...context.macroStack, name],
    macroDepth: context.macroDepth + 1
  });

  return remapQueryAstSpans(expanded, macroSpan);
}

function foldLogical(node: SyntaxNode, terms: QueryAstNode[], operator: "AND" | "OR"): QueryAstNode {
  if (terms.length === 0) {
    throw new Error(`Missing terms for ${operator}`);
  }
  let current = terms[0];
  for (let i = 1; i < terms.length; i += 1) {
    current = {
      kind: "logical",
      operator,
      left: current,
      right: terms[i],
      span: spanOf(node)
    };
  }
  return current;
}

function buildScalarValue(node: SyntaxNode, input: string): LiteralNode {
  const child = node.firstChild;
  if (!child) {
    throw new Error("ScalarValue missing child");
  }
  switch (child.name) {
    case "String": {
      const raw = textOf(child, input);
      return {
        kind: "stringLiteral",
        value: unquoteString(raw),
        span: spanOf(child)
      };
    }
    case "Number": {
      const raw = textOf(child, input);
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        throw new Error(`Invalid numeric literal: ${raw}`);
      }
      return {
        kind: "numberLiteral",
        value: parsed,
        raw,
        span: spanOf(child)
      };
    }
    case "Boolean":
      return {
        kind: "booleanLiteral",
        value: textOf(child, input) === "true",
        span: spanOf(child)
      };
    default:
      throw new Error(`Unsupported scalar child: ${child.name}`);
  }
}

function buildListValue(node: SyntaxNode, input: string): ListNode {
  const items = node.getChildren("ListItem").map((item) => {
    const scalar = expectChild(item, ["ScalarValue"]);
    return buildScalarValue(scalar, input);
  });

  return {
    kind: "list",
    items,
    span: spanOf(node)
  };
}

function expectChild(node: SyntaxNode, names: string[]): SyntaxNode {
  for (const name of names) {
    const child = node.getChild(name);
    if (child) {
      return child;
    }
  }
  throw new Error(`Expected child [${names.join(", ")}] under ${node.name}`);
}

function spanOf(node: SyntaxNode): SourceSpan {
  return { from: node.from, to: node.to };
}

function textOf(node: SyntaxNode, input: string): string {
  return input.slice(node.from, node.to);
}

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function unquoteString(raw: string): string {
  if (raw.length < 2) return raw;
  return raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function remapQueryAstSpans(node: QueryAstNode, span: SourceSpan): QueryAstNode {
  switch (node.kind) {
    case "comparison":
      return {
        ...node,
        span,
        field: {
          ...node.field,
          span
        },
        value: remapValueSpans(node.value, span)
      };
    case "logical":
      return {
        ...node,
        span,
        left: remapQueryAstSpans(node.left, span),
        right: remapQueryAstSpans(node.right, span)
      };
    case "not":
      return {
        ...node,
        span,
        expression: remapQueryAstSpans(node.expression, span)
      };
  }
}

function remapValueSpans(value: ValueNode, span: SourceSpan): ValueNode {
  if (value.kind === "list") {
    return {
      ...value,
      span,
      items: value.items.map((item) => ({ ...item, span }))
    };
  }
  return { ...value, span };
}

function computeAstStats(root: QueryAstNode): { nodeCount: number; maxDepth: number } {
  let nodeCount = 0;
  let maxDepth = 0;

  function walk(node: QueryAstNode | LiteralNode | ListNode, depth: number): void {
    nodeCount += 1;
    maxDepth = Math.max(maxDepth, depth);
    switch (node.kind) {
      case "logical":
        walk(node.left, depth + 1);
        walk(node.right, depth + 1);
        return;
      case "not":
        walk(node.expression, depth + 1);
        return;
      case "comparison":
        walk(node.value, depth + 1);
        return;
      case "list":
        for (const item of node.items) {
          walk(item, depth + 1);
        }
        return;
      default:
        return;
    }
  }

  walk(root, 1);
  return { nodeCount, maxDepth };
}

export function buildCompletionRequest(
  query: string,
  cursorOffset: number,
  grammarVersion: string,
  languageSpecVersion: string
): CompletionRequest {
  return {
    query,
    cursorOffset,
    grammarVersion,
    languageSpecVersion
  };
}
