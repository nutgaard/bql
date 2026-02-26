import { autocompletion } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { linter, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import { EditorState, type Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bqlLanguageSupport } from "@bql/query-language-lezer";
import { analyzeQuery, type QueryAnalysis } from "./analysis";
import { createCompletionSource, type CompletionCallback } from "./completion";
import type { QueryLanguageSpec } from "./types";

export type QueryEditorExtensionConfig = {
  languageSpec: QueryLanguageSpec;
  astVersion: string;
  grammarVersion: string;
  complete?: CompletionCallback;
  onChange?: (value: string) => void;
  onAnalysis?: (analysis: QueryAnalysis, value: string) => void;
  readOnly?: boolean;
};

export function createQueryEditorExtensions(config: QueryEditorExtensionConfig): Extension[] {
  const completionSource = createCompletionSource({
    languageSpec: config.languageSpec,
    grammarVersion: config.grammarVersion,
    complete: config.complete
  });

  const syntaxLinter = linter((view) => toCmDiagnostics(analyzeQuery(view.state.doc.toString(), config)));

  return [
    bqlLanguageSupport(),
    oneDark,
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    autocompletion({ override: [completionSource] }),
    syntaxLinter,
    EditorState.readOnly.of(Boolean(config.readOnly)),
    EditorView.lineWrapping,
    EditorView.theme({
      "&": {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: "14px",
        border: "1px solid #2f3545",
        borderRadius: "10px"
      },
      ".cm-content": {
        padding: "12px"
      },
      ".cm-focused": {
        outline: "2px solid #4f8cff"
      }
    }),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      const value = update.state.doc.toString();
      config.onChange?.(value);
      config.onAnalysis?.(analyzeQuery(value, config), value);
    }),
    // Force Lezer parse to run on doc changes so syntaxTree() stays warm for editor interactions.
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        syntaxTree(update.state);
      }
    })
  ];
}

function toCmDiagnostics(result: QueryAnalysis): CmDiagnostic[] {
  return result.syntaxDiagnostics.map((diagnostic) => ({
    from: diagnostic.from,
    to: diagnostic.to,
    severity: diagnostic.severity,
    message: diagnostic.message,
    source: diagnostic.source
  }));
}
