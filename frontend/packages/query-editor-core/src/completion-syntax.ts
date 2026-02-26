import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import type { QueryLanguageSpec } from "./types";

export type CompletionSyntaxContext =
  | { kind: "inListValueStart"; fieldName?: string }
  | { kind: "clauseStart" }
  | { kind: "afterNot" }
  | { kind: "afterField"; fieldName: string }
  | { kind: "partialClauseStart"; prefix: string }
  | { kind: "partialAfterNot"; prefix: string }
  | { kind: "afterInOperator" }
  | { kind: "afterCompareOperator"; fieldName?: string }
  | { kind: "clauseBoundary" }
  | { kind: "fallback" };

type ParsedCursor = {
  query: string;
  before: string;
  leafAtPos: SyntaxNode;
  leafAtTrimmed: SyntaxNode;
  trimmedPos: number;
  lastNonWhitespaceChar: string | null;
  identifierAtCursorEnd: SyntaxNode | null;
  identifierAtTrimmedPos: SyntaxNode | null;
  trailingIdentifier: string;
};

export function inferCompletionSyntaxContext(args: {
  state: EditorState;
  query: string;
  pos: number;
  spec: QueryLanguageSpec;
}): CompletionSyntaxContext {
  const cursor = parseCursor(args.state, args.query, args.pos);

  if (isInListValueElementStartContext(cursor)) {
    return { kind: "inListValueStart", fieldName: fieldNameFromEnclosingComparison(cursor) };
  }

  if (isClauseStartContext(cursor)) {
    return { kind: "clauseStart" };
  }

  if (isAfterNotKeywordContext(cursor)) {
    return { kind: "afterNot" };
  }

  const exactFieldToken = fieldNameAtTrimmedIdentifier(cursor, args.spec);
  if (exactFieldToken) {
    return { kind: "afterField", fieldName: exactFieldToken };
  }

  const partialIdentifierContext = cursor.trailingIdentifier ? inferPartialIdentifierContext(cursor) : null;
  if (partialIdentifierContext === "clauseStart") {
    return { kind: "partialClauseStart", prefix: cursor.trailingIdentifier };
  }
  if (partialIdentifierContext === "afterNot") {
    return { kind: "partialAfterNot", prefix: cursor.trailingIdentifier };
  }

  if (isAfterInOperatorContext(cursor)) {
    return { kind: "afterInOperator" };
  }

  if (isAfterCompareOperatorContext(cursor)) {
    return { kind: "afterCompareOperator", fieldName: fieldNameFromEnclosingComparison(cursor) };
  }

  if (isClauseBoundaryContext(cursor)) {
    return { kind: "clauseBoundary" };
  }

  return { kind: "fallback" };
}

function parseCursor(state: EditorState, query: string, pos: number): ParsedCursor {
  const before = query.slice(0, pos);
  const tree = syntaxTree(state);

  let lastNonWhitespacePos = pos - 1;
  while (lastNonWhitespacePos >= 0 && isWhitespaceChar(query[lastNonWhitespacePos])) {
    lastNonWhitespacePos -= 1;
  }

  const trimmedPos = lastNonWhitespacePos + 1;
  const leafAtPos = tree.topNode.resolveInner(pos, -1);
  const leafAtTrimmed = tree.topNode.resolveInner(trimmedPos, -1);
  const identifierAtCursorCandidate = nearestAncestorNamed(leafAtPos, "Identifier");
  const identifierAtTrimmedCandidate = nearestAncestorNamed(leafAtTrimmed, "Identifier");
  const identifierAtCursorEnd =
    identifierAtCursorCandidate && identifierAtCursorCandidate.to === pos ? identifierAtCursorCandidate : null;
  const identifierAtTrimmedPos =
    identifierAtTrimmedCandidate && identifierAtTrimmedCandidate.to === trimmedPos ? identifierAtTrimmedCandidate : null;
  const trailingIdentifier = identifierAtCursorEnd ? nodeText(query, identifierAtCursorEnd) : "";

  return {
    query,
    before,
    leafAtPos,
    leafAtTrimmed,
    trimmedPos,
    lastNonWhitespaceChar: lastNonWhitespacePos >= 0 ? query[lastNonWhitespacePos] : null,
    identifierAtCursorEnd,
    identifierAtTrimmedPos,
    trailingIdentifier
  };
}

function inferPartialIdentifierContext(cursor: ParsedCursor): "clauseStart" | "afterNot" | null {
  const identifier = cursor.identifierAtCursorEnd;
  if (!identifier) return null;

  const field = nearestAncestorNamed(identifier, "Field");
  const comparison = nearestAncestorNamed(identifier, "Comparison");
  const primary = nearestAncestorNamed(identifier, "Primary");
  if (!field || !comparison || !primary) {
    return null;
  }

  if (comparison.getChild("CompareOperator") || comparison.getChild("InOperator")) {
    return null;
  }

  const nearestNotExpression = nearestAncestorNamed(primary, "NotExpression");
  if (!nearestNotExpression) {
    return null;
  }

  const directPrimary = nearestNotExpression.getChild("Primary");
  if (directPrimary === primary && nearestNotExpression.getChild("NotOp")) {
    return "afterNot";
  }

  return "clauseStart";
}

function fieldNameAtTrimmedIdentifier(cursor: ParsedCursor, spec: QueryLanguageSpec): string | null {
  const identifier = cursor.identifierAtTrimmedPos;
  if (!identifier) return null;
  const text = nodeText(cursor.query, identifier);
  return spec.fields.some((field) => field.name === text) ? text : null;
}

function isClauseStartContext(cursor: ParsedCursor): boolean {
  if (cursor.before.trim().length === 0) {
    return true;
  }
  if (tokenEndingAtTrimmedPos(cursor, "AndOp") || tokenEndingAtTrimmedPos(cursor, "OrOp")) {
    return true;
  }
  if (cursor.lastNonWhitespaceChar !== "(") {
    return false;
  }
  return !nearestAncestorNamed(cursor.leafAtPos, "ListLiteral") && Boolean(nearestAncestorNamed(cursor.leafAtPos, "Group"));
}

function isAfterNotKeywordContext(cursor: ParsedCursor): boolean {
  const notOp = tokenEndingAtTrimmedPos(cursor, "NotOp");
  if (!notOp) return false;
  const notExpression = nearestAncestorNamed(notOp, "NotExpression");
  return Boolean(notExpression && !notExpression.getChild("Primary"));
}

function isAfterCompareOperatorContext(cursor: ParsedCursor): boolean {
  const op = tokenEndingAtTrimmedPos(cursor, "CompareOperator");
  if (!op) return false;
  const comparison = nearestAncestorNamed(op, "Comparison");
  return Boolean(comparison && !comparison.getChild("ScalarValue"));
}

function isAfterInOperatorContext(cursor: ParsedCursor): boolean {
  const op = tokenEndingAtTrimmedPos(cursor, "InOperator");
  if (!op) return false;
  const comparison = nearestAncestorNamed(op, "Comparison");
  return Boolean(comparison && !comparison.getChild("ListLiteral"));
}

function isInListValueElementStartContext(cursor: ParsedCursor): boolean {
  if (cursor.lastNonWhitespaceChar !== "(" && cursor.lastNonWhitespaceChar !== ",") {
    return false;
  }

  const listLiteral =
    nearestAncestorNamed(cursor.leafAtPos, "ListLiteral") ?? nearestAncestorNamed(cursor.leafAtTrimmed, "ListLiteral");
  if (!listLiteral) {
    return false;
  }

  const comparison = nearestAncestorNamed(listLiteral, "Comparison");
  return Boolean(comparison && comparison.getChild("InOperator"));
}

function isClauseBoundaryContext(cursor: ParsedCursor): boolean {
  for (let current: SyntaxNode | null = cursor.leafAtTrimmed; current; current = current.parent) {
    if (current.to !== cursor.trimmedPos) {
      continue;
    }
    if (current.name === "Comparison" && isCompleteComparisonNode(current)) {
      return true;
    }
    if (current.name === "Group") {
      return true;
    }
    if (current.name === "NotExpression" && isCompleteNotExpressionNode(current)) {
      return true;
    }
  }
  return false;
}

function isCompleteComparisonNode(node: SyntaxNode): boolean {
  if (node.name !== "Comparison") return false;
  if (node.getChild("CompareOperator") && node.getChild("ScalarValue")) return true;
  if (node.getChild("InOperator") && node.getChild("ListLiteral")) return true;
  return Boolean(node.getChild("Field"));
}

function isCompleteNotExpressionNode(node: SyntaxNode): boolean {
  if (node.name !== "NotExpression") return false;
  const primary = node.getChild("Primary");
  if (!primary) return false;
  if (node.getChild("NotOp")) {
    return primary.from > (node.getChild("NotOp")?.to ?? node.from);
  }
  return true;
}

function fieldNameFromEnclosingComparison(cursor: ParsedCursor): string | undefined {
  const comparison =
    nearestAncestorNamed(cursor.leafAtPos, "Comparison") ?? nearestAncestorNamed(cursor.leafAtTrimmed, "Comparison");
  if (!comparison) return undefined;
  return fieldNameFromComparison(cursor.query, comparison);
}

function fieldNameFromComparison(query: string, comparison: SyntaxNode): string | undefined {
  const field = comparison.getChild("Field");
  const identifier = field?.getChild("Identifier");
  return identifier ? nodeText(query, identifier) : undefined;
}

function tokenEndingAtTrimmedPos(cursor: ParsedCursor, name: string): SyntaxNode | null {
  for (let current: SyntaxNode | null = cursor.leafAtTrimmed; current; current = current.parent) {
    if (current.name === name && current.to === cursor.trimmedPos) {
      return current;
    }
  }
  return null;
}

function nearestAncestorNamed(node: SyntaxNode | null, name: string): SyntaxNode | null {
  for (let current = node; current; current = current.parent) {
    if (current.name === name) {
      return current;
    }
  }
  return null;
}

function nodeText(query: string, node: SyntaxNode): string {
  return query.slice(node.from, node.to);
}

function isWhitespaceChar(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}
