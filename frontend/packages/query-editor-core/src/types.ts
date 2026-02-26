export type QueryDiagnostic = {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  from: number;
  to: number;
  source: "syntax" | "semantic";
};

export type FieldType = "string" | "number" | "boolean";

export type FieldSpec = {
  name: string;
  type: FieldType;
  operators?: string[];
  enumValues?: string[];
  completionProviderKey?: string;
};

export type MacroAliasSpec = {
  name: string;
  kind: "macroAlias";
  expansion: string;
  detail?: string;
};

export type QueryLanguageSpec = {
  version: string;
  fields: FieldSpec[];
  operatorsByType: Partial<Record<FieldType, string[]>>;
  functions?: MacroAliasSpec[];
  completionPolicies?: Record<string, string>;
};

export type SourceSpan = { from: number; to: number };

export type FieldRefNode = {
  kind: "fieldRef";
  name: string;
  span: SourceSpan;
};

export type LiteralNode =
  | { kind: "stringLiteral"; value: string; span: SourceSpan }
  | { kind: "numberLiteral"; value: number; raw: string; span: SourceSpan }
  | { kind: "booleanLiteral"; value: boolean; span: SourceSpan };

export type ValueNode = LiteralNode | ListNode;

export type ListNode = {
  kind: "list";
  items: LiteralNode[];
  span: SourceSpan;
};

export type ComparisonNode = {
  kind: "comparison";
  field: FieldRefNode;
  operator: string;
  value: ValueNode;
  span: SourceSpan;
};

export type LogicalNode = {
  kind: "logical";
  operator: "AND" | "OR";
  left: QueryAstNode;
  right: QueryAstNode;
  span: SourceSpan;
};

export type NotNode = {
  kind: "not";
  expression: QueryAstNode;
  span: SourceSpan;
};

export type QueryAstNode = ComparisonNode | LogicalNode | NotNode;

export type QueryAstEnvelope = {
  astVersion: string;
  grammarVersion: string;
  source: { rawQuery: string };
  root: QueryAstNode;
  metadata?: {
    parser: "lezer";
    nodeCount: number;
    maxDepth: number;
  };
};

export type CompletionRequest = {
  query: string;
  cursorOffset: number;
  grammarVersion: string;
  languageSpecVersion: string;
};

export type CompletionItem = {
  label: string;
  type?: string;
  detail?: string;
  apply?: string;
};

export type CompletionResponse = {
  items: CompletionItem[];
};

export type SemanticValidateRequest = {
  query: string;
  ast: QueryAstEnvelope;
  grammarVersion: string;
  languageSpecVersion: string;
};
