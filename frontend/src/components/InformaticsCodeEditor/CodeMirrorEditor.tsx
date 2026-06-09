import { useEffect, useRef } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import {
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
};

const pythonHighlight = HighlightStyle.define([
  { tag: t.comment, color: "#6b7280", fontStyle: "italic" },
  { tag: t.keyword, color: "#7c3aed" },
  { tag: t.controlKeyword, color: "#7c3aed" },
  { tag: t.string, color: "#047857" },
  { tag: t.number, color: "#c2410c" },
  { tag: t.function(t.variableName), color: "#0b2f9f" },
  { tag: t.variableName, color: "#111827" },
]);

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13.5px",
    fontFamily:
      '"JetBrains Mono", "Fira Code", "SF Mono", "Consolas", monospace',
    backgroundColor: "#f8fafc",
    color: "#111827",
  },
  ".cm-scroller": {
    overflow: "auto",
    lineHeight: "1.55",
    backgroundColor: "#f8fafc",
  },
  ".cm-content": {
    padding: "10px 0",
    caretColor: "#1550d8",
  },
  ".cm-gutters": {
    backgroundColor: "#eef2ff",
    color: "#64748b",
    border: "none",
    borderRight: "1px solid #dde3ff",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(21, 80, 216, 0.06)",
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
  EditorView.lineWrapping,
  keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
  editorTheme,
  drawSelection(),
  EditorView.editorAttributes.of({ class: "inf-code-cm-root" }),
];

export default function CodeMirrorEditor({
  value,
  onChange,
  readOnly = false,
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

  return (
    <div
      ref={hostRef}
      className="inf-code-editor__cm"
      data-inf-code-editor="1"
    />
  );
}
