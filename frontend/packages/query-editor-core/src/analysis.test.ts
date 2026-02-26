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

    expect(result.syntaxDiagnostics).toEqual([]);
    expect(result.ast).not.toBeNull();
    expect(result.ast?.root.kind).toBe("not");
  });

  test("accepts grouped NOT logical expression", () => {
    const result = analyze('NOT (status = "Open" OR archived = true)');

    expect(result.syntaxDiagnostics).toEqual([]);
    expect(result.ast).not.toBeNull();
    expect(result.ast?.root.kind).toBe("not");
  });

  test("accepts direct NOT comparison", () => {
    const result = analyze('NOT status = "Open"');

    expect(result.syntaxDiagnostics).toEqual([]);
    expect(result.ast).not.toBeNull();
    if (!result.ast) throw new Error("expected ast");
    expect(result.ast.root.kind).toBe("not");
    if (result.ast.root.kind !== "not") throw new Error("expected not");
    expect(result.ast.root.expression.kind).toBe("comparison");
  });

  test("rejects ungrouped NOT boolean field shorthand", () => {
    const result = analyze("NOT archived");

    expect(result.ast).toBeNull();
    expect(result.syntaxDiagnostics.length).toBeGreaterThan(0);
  });
});

describe("analyzeQuery (macro aliases)", () => {
  test("expands macro alias to comparison AST", () => {
    const result = analyze("isOpen()");

    expect(result.syntaxDiagnostics).toEqual([]);
    expect(result.ast).not.toBeNull();
    if (!result.ast) throw new Error("expected ast");

    expect(result.ast.root.kind).toBe("comparison");
    if (result.ast.root.kind !== "comparison") throw new Error("expected comparison");

    expect(result.ast.root.field.name).toBe("status");
    expect(result.ast.root.operator).toBe("=");
    expect(result.ast.root.value.kind).toBe("stringLiteral");
    if (result.ast.root.value.kind !== "stringLiteral") throw new Error("expected string literal");
    expect(result.ast.root.value.value).toBe("Open");
  });

  test("maps expanded macro spans to macro call span", () => {
    const result = analyze("isOpen()");
    expect(result.ast).not.toBeNull();
    if (!result.ast || result.ast.root.kind !== "comparison") throw new Error("expected comparison");

    const macroSpan = { from: 0, to: "isOpen()".length };
    expect(result.ast.root.span).toEqual(macroSpan);
    expect(result.ast.root.field.span).toEqual(macroSpan);
    expect(result.ast.root.value.span).toEqual(macroSpan);
  });

  test("supports direct NOT on macro aliases", () => {
    const result = analyze("NOT isOpen()");

    expect(result.syntaxDiagnostics).toEqual([]);
    expect(result.ast).not.toBeNull();
    if (!result.ast) throw new Error("expected ast");

    expect(result.ast.root.kind).toBe("not");
    if (result.ast.root.kind !== "not") throw new Error("expected not");
    expect(result.ast.root.expression.kind).toBe("comparison");
  });

  test("expands macro aliases inside logical expressions", () => {
    const result = analyze("isOpen() OR archived = false");

    expect(result.syntaxDiagnostics).toEqual([]);
    expect(result.ast).not.toBeNull();
    if (!result.ast) throw new Error("expected ast");

    expect(result.ast.root.kind).toBe("logical");
    if (result.ast.root.kind !== "logical") throw new Error("expected logical");
    expect(result.ast.root.operator).toBe("OR");
    expect(result.ast.root.left.kind).toBe("comparison");
    expect(result.ast.root.right.kind).toBe("comparison");
  });

  test("returns UNKNOWN_MACRO_ALIAS for unresolved macro calls", () => {
    const result = analyze("missing()");

    expect(result.ast).toBeNull();
    expect(result.syntaxDiagnostics[0]?.code).toBe("UNKNOWN_MACRO_ALIAS");
    expect(result.syntaxDiagnostics[0]?.from).toBe(0);
    expect(result.syntaxDiagnostics[0]?.to).toBe("missing()".length);
  });

  test("returns INVALID_MACRO_EXPANSION for malformed macro templates", () => {
    const result = analyze("isOpen()", {
      ...baseSpec,
      functions: [{ name: "isOpen", kind: "macroAlias", expansion: "status =", detail: "broken" }]
    });

    expect(result.ast).toBeNull();
    expect(result.syntaxDiagnostics[0]?.code).toBe("INVALID_MACRO_EXPANSION");
  });

  test("returns DUPLICATE_MACRO_ALIAS for duplicate function names", () => {
    const result = analyze("status = \"Open\"", {
      ...baseSpec,
      functions: [
        { name: "isOpen", kind: "macroAlias", expansion: 'status = "Open"' },
        { name: "isOpen", kind: "macroAlias", expansion: 'status = "Closed"' }
      ]
    });

    expect(result.ast).toBeNull();
    expect(result.syntaxDiagnostics[0]?.code).toBe("DUPLICATE_MACRO_ALIAS");
  });

  test("returns MACRO_EXPANSION_CYCLE for recursive macro aliases", () => {
    const result = analyze("a()", {
      ...baseSpec,
      functions: [
        { name: "a", kind: "macroAlias", expansion: "b()" },
        { name: "b", kind: "macroAlias", expansion: "a()" }
      ]
    });

    expect(result.ast).toBeNull();
    expect(result.syntaxDiagnostics[0]?.code).toBe("MACRO_EXPANSION_CYCLE");
  });

  test("returns MACRO_EXPANSION_DEPTH_EXCEEDED for deep macro chains", () => {
    const result = analyze("m1()", {
      ...baseSpec,
      functions: buildDeepMacroChain(11)
    });

    expect(result.ast).toBeNull();
    expect(result.syntaxDiagnostics[0]?.code).toBe("MACRO_EXPANSION_DEPTH_EXCEEDED");
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
