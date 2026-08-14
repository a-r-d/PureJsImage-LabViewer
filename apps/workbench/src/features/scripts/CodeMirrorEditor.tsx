import { autocompletion, type CompletionContext } from '@codemirror/autocomplete'
import { javascript } from '@codemirror/lang-javascript'
import { Transaction } from '@codemirror/state'
import { basicSetup, EditorView } from 'codemirror'
import { useEffect, useRef } from 'react'

function apiCompletion(apiNames: readonly string[]) {
  const options = apiNames.map((name) => ({
    label: `lab.${name}`,
    type: 'function',
    apply: `lab.${name}`,
    detail: '@lab/api',
  }))
  return (context: CompletionContext) => {
    const word = context.matchBefore(/(?:lab\.)?[\w.]*/u)
    if (word === null || (word.from === word.to && !context.explicit)) return null
    return { from: word.from, options, validFor: /(?:lab\.)?[\w.]*/u }
  }
}

export function CodeMirrorEditor({
  apiNames,
  language,
  onChange,
  onEditorState,
  value,
}: Readonly<{
  apiNames: readonly string[]
  language: 'javascript' | 'json' | 'typescript'
  onChange(value: string): void
  onEditorState?(state: {
    readonly selectionAnchor: number
    readonly selectionHead: number
    readonly scrollTop: number
  }): void
  value: string
}>) {
  const parent = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | undefined>(undefined)
  const initialValue = useRef(value)
  const onChangeRef = useRef(onChange)
  const onEditorStateRef = useRef(onEditorState)
  onChangeRef.current = onChange
  onEditorStateRef.current = onEditorState

  useEffect(() => {
    const element = parent.current
    if (element === null) return
    const editor = new EditorView({
      doc: initialValue.current,
      parent: element,
      extensions: [
        basicSetup,
        javascript({ typescript: language === 'typescript' }),
        autocompletion({ override: [apiCompletion(apiNames)] }),
        EditorView.contentAttributes.of({ 'aria-label': 'Script source editor' }),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString())
          const selection = update.state.selection.main
          onEditorStateRef.current?.({
            selectionAnchor: selection.anchor,
            selectionHead: selection.head,
            scrollTop: update.view.scrollDOM.scrollTop,
          })
        }),
        EditorView.theme({
          '&': { height: '100%', backgroundColor: 'transparent' },
          '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--wb-font-mono)' },
          '.cm-content': { caretColor: 'var(--wb-accent)' },
          '&.cm-focused': { outline: '2px solid var(--wb-focus)', outlineOffset: '-2px' },
        }),
      ],
    })
    view.current = editor
    return () => {
      view.current = undefined
      editor.destroy()
    }
  }, [apiNames, language])

  useEffect(() => {
    const editor = view.current
    if (editor === undefined || editor.state.doc.toString() === value) return
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: value },
      annotations: Transaction.addToHistory.of(false),
    })
  }, [value])

  return <div className="script-studio__editor" ref={parent} />
}
