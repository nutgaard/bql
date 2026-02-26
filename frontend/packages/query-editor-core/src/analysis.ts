import type { SyntaxNode } from "@lezer/common";
import { bqlParser } from "@bql/query-language-lezer";
import type {
  CompletionRequest,
  QueryAstEnvelope,
  QueryAstNode,
  QueryDiagnostic,
  SourceSpan,
  ListNode,
  LiteralNode
} from "./types";

export type AnalyzeQueryOptions = {
  astVersion: string;
  grammarVersion: string;
};

export type QueryAnalysis = {
  syntaxDiagnostics: QueryDiagnostic[];
  ast: QueryAstEnvelope | null;
};

export function analyzeQuery(input: string, options: AnalyzeQueryOptions): QueryAnalysis {
  const tree = bqlParser.parse(input);
  const syntaxDiagnostics = collectSyntaxDiagnostics(tree.topNode, input);
  if (syntaxDiagnostics.length > 0) {
    return { syntaxDiagnostics, ast: null };
  }

  try {
    const root = buildAstFromQuery(tree.topNode, input);
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

function buildAstFromQuery(queryNode: SyntaxNode, input: string): QueryAstNode {
  const expression = queryNode.getChild("Expression") ?? queryNode.firstChild;
  if (!expression) {
    throw new Error("Missing Expression node");
  }
  return buildExpression(expression, input);
}

function buildExpression(node: SyntaxNode, input: string): QueryAstNode {
  switch (node.name) {
    case "Expression":
      return buildExpression(expectChild(node, ["OrExpression"]), input);
    case "OrExpression": {
      const terms = node.getChildren("AndExpression").map((child) => buildExpression(child, input));
      return foldLogical(node, terms, "OR");
    }
    case "AndExpression": {
      const terms = node.getChildren("NotExpression").map((child) => buildExpression(child, input));
      return foldLogical(node, terms, "AND");
    }
    case "NotExpression": {
      const hasNot = Boolean(node.getChild("NotOp"));
      if (hasNot) {
        const group = expectChild(node, ["Group"]);
        return {
          kind: "not",
          expression: buildExpression(expectChild(group, ["Expression"]), input),
          span: spanOf(node)
        };
      }
      return buildExpression(expectChild(node, ["Primary"]), input);
    }
    case "Primary": {
      const comparison = node.getChild("Comparison");
      if (comparison) {
        return buildExpression(comparison, input);
      }
      const group = node.getChild("Group");
      if (group) {
        return buildExpression(expectChild(group, ["Expression"]), input);
      }
      break;
    }
    case "Comparison": {
      const fieldNode = expectChild(node, ["Field"]);
      const fieldRef = {
        kind: "fieldRef" as const,
        name: textOf(expectChild(fieldNode, ["Identifier"]), input),
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
      const inOperator = expectChild(node, ["InOperator"]);
      const listLiteral = expectChild(node, ["ListLiteral"]);
      return {
        kind: "comparison",
        field: fieldRef,
        operator: normalizeSpace(textOf(inOperator, input)),
        value: buildListValue(listLiteral, input),
        span: spanOf(node)
      };
    }
  }

  throw new Error(`Unsupported node while building AST: ${node.name}`);
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
