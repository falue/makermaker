import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js';
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js';
import 'monaco-editor/editor/contrib/comment/browser/comment.js';
import 'monaco-editor/editor/contrib/find/browser/findController.js';
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution.js';
import 'monaco-editor/editor/contrib/indentation/browser/indentation.js';
import 'monaco-editor/editor/contrib/linesOperations/browser/linesOperations.js';
import 'monaco-editor/editor/contrib/multicursor/browser/multicursor.js';
import 'monaco-editor/editor/contrib/parameterHints/browser/parameterHints.js';
import 'monaco-editor/editor/contrib/suggest/browser/suggestController.js';
import 'monaco-editor/editor/contrib/wordOperations/browser/wordOperations.js';
import 'monaco-editor/languages/definitions/python/register.js';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.start.js?worker';
import { describe } from '../api/commands';

/** Python in Monaco (colours, `cad` completion and parameter hints), for the terminal's prompt and its script editor. */
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

const THEMES = { dark: 'vs-dark', light: 'vs' } as const;
for (const [name, base] of Object.entries(THEMES)) monaco.editor.defineTheme(`mm-${name}`, { base, inherit: true, rules: [], colors: { 'editor.background': '#00000000', 'focusBorder': '#00000000' } });
const dark = matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => monaco.editor.setTheme(`mm-${(document.documentElement.dataset.theme ?? (dark.matches ? 'dark' : 'light')) === 'dark' ? 'dark' : 'light'}`);
applyTheme();
dark.addEventListener('change', applyTheme);
new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

const commands = new Map(describe().map((c) => [c.name, c]));
const docOf = (name: string) => {
  const c = commands.get(name);
  return c && [c.doc, ...c.params.map((p) => `- \`${p.name}\`${p.optional ? ' (optional)' : ''}: ${p.doc}`)].join('\n');
};

/** Registers completion: `ask` gives the names Python knows for a dotted word (a callable ends in `(`). */
export function pythonCompletion(ask: (word: string) => Promise<string[]>) {
  monaco.languages.registerCompletionItemProvider('python', {
    triggerCharacters: ['.'],
    async provideCompletionItems(model, at) {
      const word = model.getLineContent(at.lineNumber).slice(0, at.column - 1).match(/[\w.]+$/)?.[0];
      if (!word) return { suggestions: [] };
      const known = word.startsWith('cad.') ? [...commands.keys()].map((n) => `cad.${n}(`).filter((n) => n.startsWith(word)) : [];
      const asked = await ask(word);
      const last = word.slice(word.lastIndexOf('.') + 1);
      const range = new monaco.Range(at.lineNumber, at.column - last.length, at.lineNumber, at.column);
      const names = [...new Set([...asked, ...known])].filter((n) => last.startsWith('_') || !n.slice(n.lastIndexOf('.', n.length - 2) + 1).startsWith('_'));
      return {
        suggestions: names.map((full) => {
          const bare = full.replace(/\($/, '');
          const label = bare.slice(bare.lastIndexOf('.') + 1);
          return { label, range, insertText: label, kind: full.endsWith('(') ? monaco.languages.CompletionItemKind.Function : monaco.languages.CompletionItemKind.Variable, documentation: bare.startsWith('cad.') ? { value: docOf(label) ?? '' } : undefined };
        }),
      };
    },
  });
}

monaco.languages.registerSignatureHelpProvider('python', {
  signatureHelpTriggerCharacters: ['(', ','],
  provideSignatureHelp(model, at) {
    const before = model.getLineContent(at.lineNumber).slice(0, at.column - 1);
    let depth = 0;
    let commas = 0;
    for (let k = before.length - 1; k >= 0; k--) {
      const ch = before[k];
      if (ch === ')' || ch === ']') depth++;
      else if (ch === ',' && !depth) commas++;
      else if ((ch === '(' || ch === '[') && depth) depth--;
      else if (ch === '(') {
        const c = commands.get(/cad\.(\w+)$/.exec(before.slice(0, k))?.[1] ?? '');
        if (!c) return null;
        const parameters = c.params.map((p) => ({ label: p.name, documentation: p.doc }));
        return { dispose() {}, value: { activeSignature: 0, activeParameter: commas, signatures: [{ label: `cad.${before.slice(0, k).match(/cad\.(\w+)$/)![1]}(${c.params.map((p) => p.name).join(', ')})`, documentation: c.doc, parameters }] } };
      }
    }
    return null;
  },
});

export interface PythonField {
  el: HTMLElement;
  /** Set: the cursor stays where it can; does not count as typing. */
  value: string;
  focus(): void;
  toEnd(): void;
  /** The cursor's line is the first or the last, a selection is empty, the suggestion list shows. */
  state(): { first: boolean; last: boolean; noSelection: boolean; suggesting: boolean; before: string };
  suggest(): void;
  /** Keys first go to `key`: true means it dealt with them. */
  onKey(key: (e: KeyboardEvent) => boolean): void;
  /** What the user typed changed it. */
  onChange(changed: () => void): void;
  /** The content's height changed (a prompt grows with it). */
  onHeight(height: (px: number) => void): void;
}

/** A Monaco field in a new element with `className`: with `prompt`, one that grows with its lines and has no margin. */
export function pythonField(className: string, prompt = false): PythonField {
  const el = Object.assign(document.createElement('div'), { className });
  const font = (getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'ui-monospace, Menlo, monospace').trim();
  const editor = monaco.editor.create(el, {
    value: '',
    language: 'python',
    automaticLayout: true,
    fontFamily: font,
    fontSize: 12,
    lineHeight: 18,
    tabSize: 4,
    insertSpaces: true,
    minimap: { enabled: false },
    stickyScroll: { enabled: false },
    scrollBeyondLastLine: false,
    contextmenu: false,
    wordBasedSuggestions: 'currentDocument',
    acceptSuggestionOnEnter: 'off', // Enter runs or goes to the next line; Tab takes a suggestion
    fixedOverflowWidgets: true,
    overviewRulerLanes: 0,
    renderLineHighlight: prompt ? 'none' : 'line',
    lineNumbers: prompt ? 'off' : 'on',
    lineNumbersMinChars: 3,
    glyphMargin: false,
    folding: !prompt,
    lineDecorationsWidth: prompt ? 0 : 8,
    wordWrap: prompt ? 'on' : 'off',
    scrollbar: prompt ? { vertical: 'hidden', horizontal: 'hidden', alwaysConsumeMouseWheel: false } : {},
  });
  // the app's shortcuts stay out of it, but for saving and opening
  el.addEventListener('keydown', (e) => {
    if (!((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'o'))) e.stopPropagation();
  });
  let quiet = false;
  const position = () => editor.getPosition() ?? new monaco.Position(1, 1);
  return {
    el,
    get value() {
      return editor.getValue();
    },
    set value(text) {
      const at = position();
      quiet = true;
      editor.setValue(text);
      quiet = false;
      editor.setPosition(at);
    },
    focus: () => editor.focus(),
    toEnd() {
      const m = editor.getModel()!;
      editor.setPosition({ lineNumber: m.getLineCount(), column: m.getLineMaxColumn(m.getLineCount()) });
    },
    state() {
      const m = editor.getModel()!;
      const at = position();
      return {
        first: at.lineNumber === 1,
        last: at.lineNumber === m.getLineCount(),
        noSelection: editor.getSelection()?.isEmpty() ?? true,
        suggesting: !!el.querySelector('.suggest-widget.visible') || !!document.querySelector('.overflowingContentWidgets .suggest-widget.visible'),
        before: m.getLineContent(at.lineNumber).slice(0, at.column - 1),
      };
    },
    suggest: () => void editor.trigger('terminal', 'editor.action.triggerSuggest', {}),
    onKey(key) {
      editor.onKeyDown((e) => {
        if (key(e.browserEvent)) (e.preventDefault(), e.stopPropagation());
      });
    },
    onChange(changed) {
      editor.onDidChangeModelContent(() => void (quiet || changed()));
    },
    onHeight(height) {
      editor.onDidContentSizeChange((e) => e.contentHeightChanged && height(e.contentHeight));
      height(editor.getContentHeight());
    },
  };
}
