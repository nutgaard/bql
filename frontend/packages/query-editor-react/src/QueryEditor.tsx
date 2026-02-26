import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { analyzeQuery, createQueryEditorExtensions, type QueryAnalysis } from "@bql/query-editor-core";
import type {
  CompletionResponse,
  QueryAstEnvelope,
  QueryDiagnostic,
  QueryLanguageSpec,
  SemanticValidateRequest
} from "@bql/query-editor-core";

export type QueryEditorProps = {
  value: string;
  onChange: (value: string) => void;
  languageSpec: QueryLanguageSpec;
  astVersion: string;
  grammarVersion: string;
  callbacks?: {
    complete?: (req: {
      query: string;
      cursorOffset: number;
      grammarVersion: string;
      languageSpecVersion: string;
    }) => Promise<CompletionResponse>;
    validateSemantics?: (req: SemanticValidateRequest) => Promise<QueryDiagnostic[]>;
  };
  onDiagnosticsChange?: (diagnostics: QueryDiagnostic[]) => void;
  onAstChange?: (ast: QueryAstEnvelope | null) => void;
  disabled?: boolean;
  readOnly?: boolean;
  placeholder?: string;
};

export function QueryEditor(props: QueryEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const latestPropsRef = useRef(props);
  const semanticSeq = useRef(0);
  const debounceTimerRef = useRef<number | null>(null);

  latestPropsRef.current = props;

  useEffect(() => {
    if (!hostRef.current) return;

    const runAnalysis = (analysis: QueryAnalysis, value: string) => {
      latestPropsRef.current.onAstChange?.(analysis.ast);
      dispatchDiagnostics(analysis.syntaxDiagnostics, analysis.ast, value);
    };

    const initialAnalysis = analyzeQuery(props.value, {
      astVersion: props.astVersion,
      grammarVersion: props.grammarVersion
    });

    const state = EditorState.create({
      doc: props.value,
      extensions: [
        createQueryEditorExtensions({
          languageSpec: props.languageSpec,
          astVersion: props.astVersion,
          grammarVersion: props.grammarVersion,
          complete: props.callbacks?.complete,
          readOnly: props.readOnly || props.disabled,
          onChange: props.onChange,
          onAnalysis: (analysis, value) => runAnalysis(analysis, value)
        })
      ]
    });

    const view = new EditorView({
      state,
      parent: hostRef.current
    });

    if (props.placeholder) {
      view.contentDOM.setAttribute("aria-placeholder", props.placeholder);
    }

    viewRef.current = view;
    runAnalysis(initialAnalysis, props.value);

    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === props.value) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: props.value }
    });
  }, [props.value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (props.placeholder) {
      view.contentDOM.setAttribute("aria-placeholder", props.placeholder);
    } else {
      view.contentDOM.removeAttribute("aria-placeholder");
    }
  }, [props.placeholder]);

  return <div ref={hostRef} />;

  function dispatchDiagnostics(syntaxDiagnostics: QueryDiagnostic[], ast: QueryAstEnvelope | null, query: string) {
    const baseDiagnostics = [...syntaxDiagnostics];
    latestPropsRef.current.onDiagnosticsChange?.(baseDiagnostics);

    const validateSemantics = latestPropsRef.current.callbacks?.validateSemantics;
    if (!validateSemantics || !ast) {
      return;
    }

    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
    }

    const requestSeq = ++semanticSeq.current;
    debounceTimerRef.current = window.setTimeout(async () => {
      try {
        const semanticDiagnostics = await validateSemantics({
          query,
          ast,
          grammarVersion: latestPropsRef.current.grammarVersion,
          languageSpecVersion: latestPropsRef.current.languageSpec.version
        });
        if (requestSeq !== semanticSeq.current) {
          return;
        }
        latestPropsRef.current.onDiagnosticsChange?.([...baseDiagnostics, ...semanticDiagnostics]);
      } catch {
        if (requestSeq !== semanticSeq.current) {
          return;
        }
        latestPropsRef.current.onDiagnosticsChange?.([
          ...baseDiagnostics,
          {
            severity: "warning",
            code: "SEMANTIC_CALLBACK_FAILED",
            message: "Semantic validation callback failed",
            from: 0,
            to: Math.max(1, query.length),
            source: "semantic"
          }
        ]);
      }
    }, 150);
  }
}
