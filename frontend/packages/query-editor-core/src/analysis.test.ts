import {describe, expect, test} from "bun:test";
import {analyzeQuery} from "./analysis";
import type {QueryLanguageSpec} from "./types";

const baseSpec: QueryLanguageSpec = {
  version: "1",
  fields: [
    { name: "status", type: "string", enumValues: ["Open", "Closed"] },
    { name: "archived", type: "boolean" }
  ],
  operatorsByType: {
    string: ["=", "!=", "IN", "NOT IN"],
    boolean: ["=", "!="]
  },
  functions: [
    {
      name: "isOpen",
      kind: "macroAlias",
      expansion: 'status = "Open"',
      detail: "Alias for open issues"
    }
  ]
};

describe("analyzeQuery (NOT syntax)", () => {
  test("accepts grouped NOT comparison", () => {
    const result = analyze('NOT (status = "Open")');

    expect(result).toMatchObject({
      syntaxDiagnostics: [],
      ast: { root: { kind: "not" } }
    });
  });

  test("accepts grouped NOT logical expression", () => {
    const result = analyze('NOT (status = "Open" OR archived = true)');

    expect(result).toMatchObject({
      syntaxDiagnostics: [],
      ast: { root: { kind: "not" } }
    });
  });

  test("accepts direct NOT comparison", () => {
    const result = analyze('NOT status = "Open"');

    expect(result).toMatchObject({
      syntaxDiagnostics: [],
      ast: {
        root: {
          kind: "not",
          expression: { kind: "comparison" }
        }
      }
    });
  });

  test("accepts ungrouped NOT boolean field shorthand", () => {
    const result = analyze("NOT archived");

    expect(result).toMatchObject({
      syntaxDiagnostics: [],
      ast: {
        root: {
          kind: "not",
          expression: {
            kind: "comparison",
            field: { name: "archived" },
            operator: "=",
            value: { kind: "booleanLiteral", value: true }
          }
        }
      }
    });
  });
});

describe("analyzeQuery (macro aliases)", () => {
  test("accepts bare boolean field shorthand", () => {
    const result = analyze("archived");

    expect(result).toMatchObject({
      syntaxDiagnostics: [],
      ast: {
        root: {
          kind: "comparison",
          field: { name: "archived" },
          operator: "=",
          value: { kind: "booleanLiteral", value: true }
        }
      }
    });
  });

  test("rejects non-boolean field shorthand", () => {
    const result = analyze("status");

    expect(result).toMatchObject({
      ast: null,
      syntaxDiagnostics: [{ code: "INVALID_BOOLEAN_FIELD_SHORTHAND" }]
    });
  });

  test("expands macro alias to comparison AST", () => {
    const result = analyze("isOpen()");

    expect(result).toMatchObject({
      syntaxDiagnostics: [],
      ast: {
        root: {
          kind: "comparison",
          field: { name: "status" },
          operator: "=",
          value: { kind: "stringLiteral", value: "Open" }
        }
      }
    });
  });

  test("maps expanded macro spans to macro call span", () => {
    const result = analyze("isOpen()");
    expect(result).toMatchObject({
      syntaxDiagnostics: [],
      ast: { root: { kind: "comparison" } }
    });
    const root = result.ast?.root;
    if (!root || root.kind !== "comparison") {
      throw new Error("expected comparison root");
    }

    const macroSpan = { from: 0, to: "isOpen()".length };
    expect(root.span).toEqual(macroSpan);
    expect(root.field.span).toEqual(macroSpan);
    expect(root.value.span).toEqual(macroSpan);
  });

  test("supports direct NOT on macro aliases", () => {
    const result = analyze("NOT isOpen()");

    expect(result).toMatchObject({
      syntaxDiagnostics: [],
      ast: {
        root: {
          kind: "not",
          expression: { kind: "comparison" }
        }
      }
    });
  });

  test("expands macro aliases inside logical expressions", () => {
    const result = analyze("isOpen() OR archived = false");

    expect(result).toMatchObject({
      syntaxDiagnostics: [],
      ast: {
        root: {
          kind: "logical",
          operator: "OR",
          left: { kind: "comparison" },
          right: { kind: "comparison" }
        }
      }
    });
  });

  test("returns UNKNOWN_MACRO_ALIAS for unresolved macro calls", () => {
    const result = analyze("missing()");

    expect(result).toMatchObject({
      ast: null,
      syntaxDiagnostics: [{ code: "UNKNOWN_MACRO_ALIAS" }]
    });
    const diagnostic = result.syntaxDiagnostics[0]!;
    expect(diagnostic).toMatchObject({ from: 0, to: "missing()".length });
  });

  test("returns INVALID_MACRO_EXPANSION for malformed macro templates", () => {
    const result = analyze("isOpen()", {
      ...baseSpec,
      functions: [{ name: "isOpen", kind: "macroAlias", expansion: "status =", detail: "broken" }]
    });

    expect(result).toMatchObject({
      ast: null,
      syntaxDiagnostics: [{ code: "INVALID_MACRO_EXPANSION" }]
    });
  });

  test("returns DUPLICATE_MACRO_ALIAS for duplicate function names", () => {
    const result = analyze("status = \"Open\"", {
      ...baseSpec,
      functions: [
        { name: "isOpen", kind: "macroAlias", expansion: 'status = "Open"' },
        { name: "isOpen", kind: "macroAlias", expansion: 'status = "Closed"' }
      ]
    });

    expect(result).toMatchObject({
      ast: null,
      syntaxDiagnostics: [{ code: "DUPLICATE_MACRO_ALIAS" }]
    });
  });

  test("returns MACRO_EXPANSION_CYCLE for recursive macro aliases", () => {
    const result = analyze("a()", {
      ...baseSpec,
      functions: [
        { name: "a", kind: "macroAlias", expansion: "b()" },
        { name: "b", kind: "macroAlias", expansion: "a()" }
      ]
    });

    expect(result).toMatchObject({
      ast: null,
      syntaxDiagnostics: [{ code: "MACRO_EXPANSION_CYCLE" }]
    });
  });

  test("returns MACRO_EXPANSION_DEPTH_EXCEEDED for deep macro chains", () => {
    const result = analyze("m1()", {
      ...baseSpec,
      functions: buildDeepMacroChain(11)
    });

    expect(result).toMatchObject({
      ast: null,
      syntaxDiagnostics: [{ code: "MACRO_EXPANSION_DEPTH_EXCEEDED" }]
    });
  });
});

function analyze(input: string, languageSpec: QueryLanguageSpec = baseSpec) {
  return analyzeQuery(input, {
    astVersion: "1",
    grammarVersion: "1",
    languageSpec
  });
}

function buildDeepMacroChain(length: number): NonNullable<QueryLanguageSpec["functions"]> {
  const functions: NonNullable<QueryLanguageSpec["functions"]> = [];
  for (let i = 1; i <= length; i += 1) {
    functions.push({
      name: `m${i}`,
      kind: "macroAlias",
      expansion: i === length ? 'status = "Open"' : `m${i + 1}()`
    });
  }
  return functions;
}
