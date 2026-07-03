import { useEffect, useRef } from "react";
import { Compartment, EditorState, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentWithTab,
} from "@codemirror/commands";
import {
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
  HighlightStyle,
} from "@codemirror/language";
import { python } from "@codemirror/lang-python";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { tags as t } from "@lezer/highlight";

type Props = {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  errorLine?: number;
};

const errorLineEffect = StateEffect.define<number | undefined>();

const errorLineField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decs, tr) {
    for (const e of tr.effects) {
      if (e.is(errorLineEffect)) {
        if (e.value == null || e.value < 1) return Decoration.none;
        try {
          const line = tr.state.doc.line(e.value);
          return Decoration.set([
            Decoration.line({ class: "cm-errorLine" }).range(line.from),
          ]);
        } catch {
          return Decoration.none;
        }
      }
    }
    return decs.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

const pythonHighlight = HighlightStyle.define([
  { tag: t.comment, color: "#8b95a8", fontStyle: "italic" },
  { tag: t.keyword, color: "#5b4fc7" },
  { tag: t.controlKeyword, color: "#5b4fc7" },
  { tag: t.string, color: "#0d7a5f" },
  { tag: t.number, color: "#b45309" },
  { tag: t.function(t.variableName), color: "#1550d8" },
  { tag: t.variableName, color: "#1f2937" },
]);

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13px",
    fontFamily: 'var(--font-mono, "JetBrains Mono", ui-monospace, monospace)',
    backgroundColor: "#ffffff",
    color: "#1f2937",
  },
  ".cm-scroller": {
    overflow: "auto",
    lineHeight: "1.6",
    backgroundColor: "#ffffff",
  },
  ".cm-content": {
    padding: "12px 0",
    caretColor: "#1550d8",
  },
  ".cm-gutters": {
    backgroundColor: "#fafbfc",
    color: "#9ba3c4",
    border: "none",
    borderRight: "1px solid #eef0f4",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(21, 80, 216, 0.04)",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 10px 0 8px",
    minWidth: "2.25rem",
  },
  ".cm-errorLine": {
    backgroundColor: "rgba(220, 38, 38, 0.06)",
    borderLeft: "2px solid #dc2626",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "rgba(21, 80, 216, 0.14) !important",
  },
});

const baseExtensions = [
  lineNumbers(),
  highlightActiveLine(),
  history(),
  indentOnInput(),
  bracketMatching(),
  closeBrackets(),
  python(),
  syntaxHighlighting(pythonHighlight),
  errorLineField,
  EditorView.lineWrapping,
  keymap.of([
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...historyKeymap,
    indentWithTab,
    { key: "Shift-Tab", run: indentLess },
  ]),
  editorTheme,
  drawSelection(),
  EditorView.editorAttributes.of({ class: "inf-code-cm-root" }),
];

export default function CodeMirrorEditor({
  value,
  onChange,
  readOnly = false,
  errorLine,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const editableCompartment = useRef(new Compartment());
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!hostRef.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        ...baseExtensions,
        editableCompartment.current.of(EditorView.editable.of(!readOnly)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: editableCompartment.current.reconfigure(
        EditorView.editable.of(!readOnly)
      ),
    });
  }, [readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: errorLineEffect.of(errorLine),
    });
  }, [errorLine]);

  return (
    <div
      ref={hostRef}
      className="inf-code-editor__cm"
      data-inf-code-editor="1"
    />
  );
}
