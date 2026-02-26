import { useState } from "react";
import { QueryEditor } from "@bql/query-editor-react";
import type { QueryAstEnvelope, QueryDiagnostic, QueryLanguageSpec } from "@bql/query-editor-core";

const languageSpec: QueryLanguageSpec = {
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
  functions: [
    { name: "isOpen", kind: "macroAlias", expansion: 'status = "Open"', detail: "Alias for open issues" }
  ]
};

export function App() {
  const [value, setValue] = useState('status IN ("Open", "Closed") AND archived = false');
  const [diagnostics, setDiagnostics] = useState<QueryDiagnostic[]>([]);
  const [ast, setAst] = useState<QueryAstEnvelope | null>(null);

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">BQL</p>
        <h1>Lezer-powered query editor</h1>
        <p className="lead">Browser-first parsing, AST emission, and backend-ready validation contract.</p>
      </section>

      <section className="panel editor-panel">
        <QueryEditor
          value={value}
          onChange={setValue}
          languageSpec={languageSpec}
          astVersion="1"
          grammarVersion="1"
          placeholder="Type a query"
          onDiagnosticsChange={setDiagnostics}
          onAstChange={setAst}
          callbacks={{
            //complete: async () => ({ items: [{ label: '"Open"', type: "constant", detail: "demo remote" }] }),
            complete: async () => ({ items: [] }),
            validateSemantics: async ({ ast }) => {
              if (ast.root.kind === "comparison" && ast.root.field.name === "priority" && ast.root.value.kind === "stringLiteral") {
                return [
                  {
                    severity: "error",
                    code: "TYPE_MISMATCH",
                    message: "priority expects a number",
                    from: ast.root.value.span.from,
                    to: ast.root.value.span.to,
                    source: "semantic"
                  }
                ];
              }
              return [];
            }
          }}
        />
      </section>

      <section className="grid">
        <div className="panel">
          <h2>Diagnostics</h2>
          <pre>{JSON.stringify(diagnostics, null, 2)}</pre>
        </div>
        <div className="panel">
          <h2>AST Envelope</h2>
          <pre>{JSON.stringify(ast, null, 2)}</pre>
        </div>
      </section>
    </main>
  );
}
