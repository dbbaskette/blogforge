import Link from "@tiptap/extension-link";
import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { marked } from "marked";
import { useCallback, useEffect, useMemo, useState } from "react";
import TurndownService from "turndown";

import { type InlineAction, inlineEdit } from "../../api/drafts";

export interface MarkdownEditorProps {
  initialMarkdown: string;
  onSave: (md: string) => Promise<void>;
  onChange?: (md: string) => void;
  /** When set, the rich editor shows a floating AI toolbar on text selection. */
  draftId?: string;
}

type Mode = "rich" | "raw";

export function MarkdownEditor({
  initialMarkdown,
  onSave,
  onChange,
  draftId,
}: MarkdownEditorProps): JSX.Element {
  const [raw, setRaw] = useState<string>(initialMarkdown);
  const [mode, setMode] = useState<Mode>("rich");
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Anchor for the floating AI toolbar; null when nothing is selected.
  const [aiAnchor, setAiAnchor] = useState<{ top: number; left: number } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const turndown = useMemo(
    () =>
      new TurndownService({
        headingStyle: "atx",
        codeBlockStyle: "fenced",
        bulletListMarker: "-",
      }),
    [],
  );

  const editor = useEditor({
    extensions: [StarterKit, Link.configure({ openOnClick: false })],
    content: "",
    editorProps: {
      attributes: {
        class: "prose-body max-w-none min-h-[200px] p-5 focus:outline-none",
      },
    },
    onUpdate: ({ editor: e }) => {
      if (onChange) {
        const md = turndown.turndown(e.getHTML());
        onChange(md);
      }
    },
    onSelectionUpdate: ({ editor: e }) => {
      // Surface the AI toolbar only for a real, non-empty selection.
      const { from, to, empty } = e.state.selection;
      if (empty || !draftId) {
        setAiAnchor(null);
        return;
      }
      const start = e.view.coordsAtPos(from);
      const end = e.view.coordsAtPos(to);
      setAiAnchor({
        top: Math.min(start.top, end.top),
        left: (start.left + end.right) / 2,
      });
    },
  });

  useEffect(() => {
    if (!editor) return;
    const html = marked.parse(initialMarkdown) as string;
    editor.commands.setContent(html);
    setRaw(initialMarkdown);
  }, [initialMarkdown, editor]);

  const handleSave = useCallback(async () => {
    if (!editor) return;
    setSaving(true);
    setError(null);
    const content = mode === "rich" ? turndown.turndown(editor.getHTML()) : raw;
    try {
      await onSave(content);
      setSavedMessage("Saved");
      setTimeout(() => setSavedMessage(null), 2000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [editor, mode, raw, turndown, onSave]);

  const handleSwitchMode = (next: Mode): void => {
    if (next === mode || !editor) return;
    if (next === "raw") {
      setRaw(turndown.turndown(editor.getHTML()));
    } else {
      editor.commands.setContent(marked.parse(raw) as string);
    }
    setAiAnchor(null);
    setMode(next);
  };

  const runInlineAction = useCallback(
    async (action: InlineAction): Promise<void> => {
      if (!editor || !draftId) return;
      const { from, to } = editor.state.selection;
      const text = editor.state.doc.textBetween(from, to, "\n");
      if (!text.trim()) return;
      let instruction: string | undefined;
      if (action === "custom") {
        const asked = window.prompt("How should I rewrite the selection?");
        if (!asked?.trim()) return;
        instruction = asked.trim();
      }
      setAiBusy(true);
      setError(null);
      try {
        const { text: rewritten } = await inlineEdit(draftId, { text, action, instruction });
        const html = marked.parse(rewritten) as string;
        editor.chain().focus().insertContentAt({ from, to }, html).run();
        setAiAnchor(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setAiBusy(false);
      }
    },
    [editor, draftId],
  );

  const handleRawChange = (val: string): void => {
    setRaw(val);
    if (onChange) onChange(val);
  };

  return (
    <div className="flex flex-col border border-rule rounded-nb overflow-hidden bg-white">
      <header className="border-b border-rule px-3 py-2 flex items-center gap-3 bg-card-2">
        <div
          className="inline-flex bg-canvas rounded-md p-0.5 border border-rule"
          role="tablist"
          aria-label="Editor mode"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "rich"}
            onClick={() => handleSwitchMode("rich")}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
              mode === "rich" ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            Rich
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "raw"}
            onClick={() => handleSwitchMode("raw")}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
              mode === "raw" ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            Raw
          </button>
        </div>
        <div className="flex-1" />
        {error && <span className="text-xs text-rose-ink">{error}</span>}
        {savedMessage && (
          <span className="text-xs text-leaf font-medium animate-fade-in">✓ {savedMessage}</span>
        )}
        <button type="button" onClick={handleSave} disabled={saving} className="nb-btn nb-btn-sm">
          {saving ? "Saving…" : "Save"}
        </button>
      </header>

      {mode === "rich" && editor && (
        <>
          <Toolbar editor={editor} />
          <div className="bg-white">
            <EditorContent editor={editor} />
          </div>
          {draftId && aiAnchor && (
            <AiSelectionToolbar anchor={aiAnchor} busy={aiBusy} onAction={runInlineAction} />
          )}
        </>
      )}
      {mode === "raw" && (
        <textarea
          value={raw}
          onChange={(e) => handleRawChange(e.target.value)}
          className="min-h-[200px] bg-white text-ink font-mono text-[13px] p-5 focus:outline-none resize-none leading-relaxed"
        />
      )}
    </div>
  );
}

interface AiSelectionToolbarProps {
  anchor: { top: number; left: number };
  busy: boolean;
  onAction: (action: InlineAction) => void;
}

const AI_ACTIONS: { action: InlineAction; label: string }[] = [
  { action: "rephrase", label: "Rephrase" },
  { action: "shorten", label: "Shorten" },
  { action: "expand", label: "Expand" },
  { action: "fix", label: "Fix" },
  { action: "custom", label: "Ask…" },
];

/** Floating voice-aware AI bar shown above the current selection. Dependency-
 * free (no @tiptap BubbleMenu); positioned with viewport coords from the
 * editor. `onMouseDown` is suppressed so clicking a button keeps the
 * selection alive. */
function AiSelectionToolbar({ anchor, busy, onAction }: AiSelectionToolbarProps): JSX.Element {
  return (
    <div
      className="fixed z-50 -translate-x-1/2 -translate-y-full flex items-center gap-0.5 bg-ink text-white rounded-nb-sm shadow-nb-pop px-1 py-1 animate-fade-in"
      style={{ top: anchor.top - 8, left: anchor.left }}
      onMouseDown={(e) => e.preventDefault()}
      role="toolbar"
      aria-label="AI editing actions"
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-white/50 px-1.5">
        {busy ? "…" : "AI"}
      </span>
      {AI_ACTIONS.map(({ action, label }) => (
        <button
          key={action}
          type="button"
          disabled={busy}
          onClick={() => onAction(action)}
          className="px-2 py-1 text-xs font-medium rounded hover:bg-white/15 disabled:opacity-40 transition-colors"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

interface ToolbarProps {
  editor: Editor | null;
}

function Toolbar({ editor }: ToolbarProps): JSX.Element | null {
  if (!editor) return null;
  return (
    <div className="border-b border-rule px-3 py-1.5 flex items-center gap-0.5 bg-card-2">
      <TButton
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        label="Heading 2"
      >
        <span className="font-serif text-sm font-semibold">H2</span>
      </TButton>
      <TButton
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        label="Heading 3"
      >
        <span className="font-serif text-xs font-semibold">H3</span>
      </TButton>
      <Divider />
      <TButton
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
        label="Bold"
      >
        <b>B</b>
      </TButton>
      <TButton
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        label="Italic"
      >
        <i>I</i>
      </TButton>
      <TButton
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        label="Strikethrough"
      >
        <s>S</s>
      </TButton>
      <Divider />
      <TButton
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        label="Bullet list"
      >
        •
      </TButton>
      <TButton
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        label="Numbered list"
      >
        <span className="font-mono">1.</span>
      </TButton>
      <TButton
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        label="Blockquote"
      >
        <span className="font-serif">❝</span>
      </TButton>
      <TButton
        active={editor.isActive("code")}
        onClick={() => editor.chain().focus().toggleCode().run()}
        label="Inline code"
      >
        <span className="font-mono text-xs">&lt;/&gt;</span>
      </TButton>
    </div>
  );
}

function Divider(): JSX.Element {
  return <div aria-hidden className="w-px h-5 bg-rule mx-1.5" />;
}

interface TButtonProps {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}

function TButton({ active, onClick, label, children }: TButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={`min-w-[28px] h-7 px-2 rounded-md text-xs flex items-center justify-center transition-colors ${
        active ? "bg-cobalt-50 text-cobalt-700" : "text-ink-2 hover:bg-canvas"
      }`}
    >
      {children}
    </button>
  );
}
