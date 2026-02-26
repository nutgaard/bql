import { describe, expect, test } from "bun:test";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { createCompletionSource, type CompletionCallback } from "./completion";
import type { QueryLanguageSpec } from "./types";

const baseSpec: QueryLanguageSpec = {
  version: "1",
  fields: [
    { name: "status", type: "string", enumValues: ["Open", "Closed", "In Progress"] },
    { name: "priority", type: "number" },
    { name: "assignee", type: "string" },
    { name: "archived", type: "boolean" }
  ],
  operatorsByType: {
    string: ["=", "!=", "IN", "NOT IN"],
    number: ["=", "!=", ">", ">=", "<", "<=", "IN", "NOT IN"],
    boolean: ["=", "!="]
  },
  functions: []
};

type RunCompletionArgs = {
  queryWithCursor: string;
  spec?: QueryLanguageSpec;
  callback?: CompletionCallback;
  explicit?: boolean;
  grammarVersion?: string;
};

type CompletionRunResult = {
  query: string;
  cursorOffset: number;
  from: number | null;
  labels: string[];
  result: Awaited<ReturnType<ReturnType<typeof createCompletionSource>>>;
};

type SuggestionCase = {
  name: string;
  queryWithCursor: string;
  expectedLabels: string[];
  explicit?: boolean;
};

describe("createCompletionSource (static suggestions)", () => {
  const clauseStartCases: SuggestionCase[] = [
    {
      name: "start of query",
      queryWithCursor: "|",
      expectedLabels: ["status", "priority", "assignee", "archived", "NOT"]
    },
    {
      name: "after open parenthesis",
      queryWithCursor: "( |",
      expectedLabels: ["status", "priority", "assignee", "archived", "NOT"]
    },
    {
      name: "after AND",
      queryWithCursor: 'status = "Open" AND |',
      expectedLabels: ["status", "priority", "assignee", "archived", "NOT"]
    },
    {
      name: "after OR",
      queryWithCursor: 'status = "Open" OR |',
      expectedLabels: ["status", "priority", "assignee", "archived", "NOT"]
    },
    {
      name: "after NOT",
      queryWithCursor: "NOT |",
      expectedLabels: ["status", "priority", "assignee", "archived", "NOT"]
    }
  ];

  for (const testCase of clauseStartCases) {
    test(`suggests fields and NOT at clause start (${testCase.name})`, async () => {
      const result = await runCompletionCase({ queryWithCursor: testCase.queryWithCursor, explicit: testCase.explicit });
      expect(result.result).not.toBeNull();
      expectLabelsToContain(result.labels, testCase.expectedLabels);
    });
  }

  test("returns string operators after string field", async () => {
    const result = await runCompletionCase({ queryWithCursor: "status |" });
    expectLabelsExactly(result.labels, ["=", "!=", "IN", "NOT IN"]);
  });

  test("returns numeric operators after numeric field", async () => {
    const result = await runCompletionCase({ queryWithCursor: "priority |" });
    expectLabelsExactly(result.labels, ["=", "!=", ">", ">=", "<", "<=", "IN", "NOT IN"]);
  });

  test("returns boolean operators after boolean field", async () => {
    const result = await runCompletionCase({ queryWithCursor: "archived |" });
    expectLabelsExactly(result.labels, ["=", "!="]);
  });

  test("returns value suggestions after scalar operator", async () => {
    const result = await runCompletionCase({ queryWithCursor: "status = |" });
    expectLabelsToContain(result.labels, ['""', "true", "false", "(", '"Open"', '"Closed"']);
  });

  test("returns value suggestions after IN", async () => {
    const result = await runCompletionCase({ queryWithCursor: "status IN |" });
    expectLabelsToContain(result.labels, ['""', "true", "false", "(", '"Open"']);
  });

  test("returns value suggestions after NOT IN", async () => {
    const result = await runCompletionCase({ queryWithCursor: "status NOT IN |" });
    expectLabelsToContain(result.labels, ['""', "true", "false", "(", '"Open"']);
  });

  test("returns fallback suggestions mid-expression (current behavior)", async () => {
    const result = await runCompletionCase({ queryWithCursor: 'status = "Open" |' });
    expectLabelsToContain(result.labels, ["AND", "OR", "IN", "status", "priority", "assignee", "archived"]);
  });

  test("returns non-null result in unknown token context (current behavior)", async () => {
    const result = await runCompletionCase({ queryWithCursor: "@@|" });
    expect(result.result).not.toBeNull();
    expectLabelsToContain(result.labels, ["AND", "OR", "IN", "status"]);
  });
});

describe("createCompletionSource (callback, dedupe, and offsets)", () => {
  test("merges callback suggestions and dedupes overlapping items", async () => {
    let requestPayload: Parameters<NonNullable<CompletionCallback>>[0] | null = null;
    const callback: CompletionCallback = async (req) => {
      requestPayload = req;
      return {
        items: [
          { label: '"Open"', type: "constant", detail: "remote duplicate" },
          { label: "TEAM-42", type: "constant", detail: "remote" }
        ]
      };
    };

    const result = await runCompletionCase({
      queryWithCursor: "status = |",
      callback,
      grammarVersion: "grammar-v1"
    });

    expectLabelsToContain(result.labels, ['"Open"', "TEAM-42"]);
    expect(result.labels.filter((label) => label === '"Open"')).toHaveLength(1);
    expect(requestPayload).not.toBeNull();
    expect(requestPayload!).toEqual({
      query: "status = ",
      cursorOffset: 9,
      grammarVersion: "grammar-v1",
      languageSpecVersion: "1"
    });
  });

  test("ignores callback errors and still returns static suggestions", async () => {
    const callback: CompletionCallback = async () => {
      throw new Error("network failed");
    };

    const result = await runCompletionCase({ queryWithCursor: "status = |", callback });
    expect(result.result).not.toBeNull();
    expectLabelsToContain(result.labels, ['""', "true", "false", "(", '"Open"']);
  });

  test("dedupes enum suggestions repeated across fields", async () => {
    const spec: QueryLanguageSpec = {
      ...baseSpec,
      fields: [
        ...baseSpec.fields,
        { name: "resolution", type: "string", enumValues: ["Open", "Won't Fix"] }
      ]
    };

    const result = await runCompletionCase({ queryWithCursor: "status = |", spec });
    expect(result.labels.filter((label) => label === '"Open"')).toHaveLength(1);
    expectLabelsToContain(result.labels, ['"Won\'t Fix"']);
  });

  test("uses word start as completion 'from' for partial field tokens", async () => {
    const result = await runCompletionCase({ queryWithCursor: "sta|" });
    expect(result.from).toBe(0);
    expectLabelsToContain(result.labels, ["status"]);
  });

  test("uses word start as completion 'from' for callback-provided value tokens", async () => {
    const result = await runCompletionCase({
      queryWithCursor: "status = Op|",
      callback: async () => ({
        items: [{ label: '"Open"', type: "constant" }]
      })
    });
    expect(result.from).toBe("status = ".length);
    expectLabelsToContain(result.labels, ['"Open"']);
  });

  test("uses cursor position as completion 'from' when no word precedes cursor", async () => {
    const result = await runCompletionCase({ queryWithCursor: 'status = "Open" |' });
    expect(result.from).toBe('status = "Open" '.length);
  });
});

function expectLabelsExactly(actual: string[], expected: string[]) {
  expect(actual).toEqual(expected);
}

function expectLabelsToContain(actual: string[], expected: string[]) {
  for (const label of expected) {
    expect(actual).toContain(label);
  }
}

async function runCompletionCase(args: RunCompletionArgs): Promise<CompletionRunResult> {
  const { query, cursorOffset } = parseQueryWithCursor(args.queryWithCursor);
  const source = createCompletionSource({
    languageSpec: args.spec ?? baseSpec,
    grammarVersion: args.grammarVersion ?? "1",
    complete: args.callback
  });
  const state = EditorState.create({ doc: query });
  const context = new CompletionContext(state, cursorOffset, args.explicit ?? true);
  const result = await source(context);

  return {
    query,
    cursorOffset,
    from: result?.from ?? null,
    labels: result?.options.map((option) => option.label) ?? [],
    result
  };
}

function parseQueryWithCursor(queryWithCursor: string): { query: string; cursorOffset: number } {
  const first = queryWithCursor.indexOf("|");
  const last = queryWithCursor.lastIndexOf("|");
  if (first === -1 || first !== last) {
    throw new Error("queryWithCursor must contain exactly one '|' cursor marker");
  }

  return {
    query: queryWithCursor.slice(0, first) + queryWithCursor.slice(first + 1),
    cursorOffset: first
  };
}
