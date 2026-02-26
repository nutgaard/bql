import { describe, expect, test } from "bun:test";
import { analyzeQuery } from "./analysis";

describe("analyzeQuery (NOT grouping syntax)", () => {
  test("accepts grouped NOT comparison", () => {
    const result = analyzeQuery('NOT (status = "Open")', {
      astVersion: "1",
      grammarVersion: "1"
    });

    expect(result.syntaxDiagnostics).toEqual([]);
    expect(result.ast).not.toBeNull();
    expect(result.ast?.root.kind).toBe("not");
  });

  test("accepts grouped NOT logical expression", () => {
    const result = analyzeQuery('NOT (status = "Open" OR archived = true)', {
      astVersion: "1",
      grammarVersion: "1"
    });

    expect(result.syntaxDiagnostics).toEqual([]);
    expect(result.ast).not.toBeNull();
    expect(result.ast?.root.kind).toBe("not");
  });

  test("rejects ungrouped NOT comparison", () => {
    const result = analyzeQuery('NOT status = "Open"', {
      astVersion: "1",
      grammarVersion: "1"
    });

    expect(result.ast).toBeNull();
    expect(result.syntaxDiagnostics.length).toBeGreaterThan(0);
  });

  test("rejects ungrouped NOT boolean field shorthand", () => {
    const result = analyzeQuery("NOT archived", {
      astVersion: "1",
      grammarVersion: "1"
    });

    expect(result.ast).toBeNull();
    expect(result.syntaxDiagnostics.length).toBeGreaterThan(0);
  });
});
