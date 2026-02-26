import {describe, expect, test} from "bun:test";
import {CompletionContext} from "@codemirror/autocomplete";
import {EditorState} from "@codemirror/state";
import {type CompletionCallback, createCompletionSource} from "./completion";
import type {QueryLanguageSpec} from "./types";

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

describe("createCompletionSource (static suggestions)", () => {
  const testCases = {
    'suggests fields and NOT at clause start (start of query)': {
      input: '|',
      expectedLabels: ["status", "priority", "assignee", "archived", "NOT"]
    },
    'suggests fields and NOT at clause start (after open parenthesis)': {
      input: '( |',
      expectedLabels: ["status", "priority", "assignee", "archived", "NOT"]
    },
    'suggests fields and NOT at clause start (after AND)': {
      input: 'status = "Open" AND |',
      expectedLabels: ["status", "priority", "assignee", "archived", "NOT"]
    },
    'suggests fields and NOT at clause start (after OR)': {
      input: 'status = "Open" OR |',
      expectedLabels: ["status", "priority", "assignee", "archived", "NOT"]
    },
    'suggests open parenthesis after NOT': {
      input: "NOT |",
      expectedLabels: ["("]
    },
    'returns string operators after string field': {
      input: "status |",
      expectedLabels: ["=", "!=", "IN", "NOT IN"]
    },
    'returns operator suggestion after scalar operator within group': {
      input: "NOT (status |",
      expectedLabels: ["=", "!=", "IN", "NOT IN"]
    },
    'returns numeric operators after numeric field': {
      input: "priority |",
      expectedLabels: ["=", "!=", ">", ">=", "<", "<=", "IN", "NOT IN"]
    },
    'returns boolean operators after boolean field': {
      input: "archived |",
      expectedLabels: ["=", "!="]
    },
    'returns value suggestions after scalar operator': {
      input: "status = |",
      expectedLabels: ['"Open"', '"Closed"', '"In Progress"']
    },
    'returns boolean-only suggestions for boolean field scalar operator': {
      input: "archived = |",
      expectedLabels: ["true", "false"]
    },
    'returns string placeholder for non-enum string field scalar operator': {
      input: "assignee = |",
      expectedLabels: ['""']
    },
    'returns numeric placeholder for number field scalar operator': {
      input: "priority > |",
      expectedLabels: ["0"]
    },
    'suggests list opener after IN': {
      input: "status IN |",
      expectedLabels: ["("]
    },
    'suggests list opener after NOT IN': {
      input: "status NOT IN |",
      expectedLabels: ["("]
    },
    'returns scalar suggestions inside IN list': {
      input: "status IN (|",
      expectedLabels: ['"Open"', '"Closed"', '"In Progress"']
    },
    'returns boolean connectors after completed expression': {
      input: 'status = "Open" |',
      expectedLabels: ["AND", "OR"]
    },
    'returns non-null result in unknown token context': {
      input: '@@|',
      expectedLabels: ["AND", "OR", "IN", "status", "priority", "assignee", "archived"]
    },
  };

  for (const [name, {input, expectedLabels}] of Object.entries(testCases)) {
    test(name, async () => {
      const result = await runCompletionCase({ queryWithCursor: input });
      expect(result.labels).toEqual(expectedLabels);
    });
  }
});

describe("createCompletionSource (callback, dedupe, and offsets)", () => {
  test("merges callback suggestions and dedupes overlapping items", async () => {
    const callback: CompletionCallback = async () => {
      return {
        items: [
          { label: '"Open"', type: "constant", detail: "remote duplicate" },
          { label: "TEAM-42", type: "constant", detail: "remote" }
        ]
      };
    };

    const result = await runCompletionCase({
      queryWithCursor: "status = |",
      callback
    });

    expect(result.labels).toEqual(['"Open"', '"Closed"', '"In Progress"', "TEAM-42"]);
  });

  test("passes query/cursor/version metadata to callback", async () => {
    let requestPayload: Parameters<NonNullable<CompletionCallback>>[0] | null = null;
    const callback: CompletionCallback = async (req) => {
      requestPayload = req;
      return { items: [] };
    };

    await runCompletionCase({
      queryWithCursor: "status = |",
      callback,
      grammarVersion: "grammar-v1"
    });

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
    expect(result.labels).toEqual(['"Open"', '"Closed"', '"In Progress"']);
  });

  test("does not leak enum suggestions from other fields", async () => {
    const spec: QueryLanguageSpec = {
      ...baseSpec,
      fields: [
        ...baseSpec.fields,
        { name: "resolution", type: "string", enumValues: ["Open", "Won't Fix"] }
      ]
    };

    const result = await runCompletionCase({ queryWithCursor: "status = |", spec });
    expect(result.labels).toEqual(['"Open"', '"Closed"', '"In Progress"']);
  });

  test("uses word start as completion 'from' for partial field tokens", async () => {
    const result = await runCompletionCase({ queryWithCursor: "sta|" });
    expect(result.from).toBe(0);
    expect(result.labels).toContain("status");
  });

  test("uses word start as completion 'from' for callback-provided value tokens", async () => {
    const result = await runCompletionCase({
      queryWithCursor: "status = D|",
      callback: async () => ({
        items: [{ label: '"Dont do"', type: "constant" }]
      })
    });
    expect(result.from).toBe("status = ".length);
    expect(result.labels).toContain('"Dont do"');
  });

  test("uses cursor position as completion 'from' when no word precedes cursor", async () => {
    const result = await runCompletionCase({ queryWithCursor: 'status = "Open" |' });
    expect(result.from).toBe('status = "Open" '.length);
  });
});

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
