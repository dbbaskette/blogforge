import Link from "@tiptap/extension-link";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { marked } from "marked";
import { useCallback, useEffect, useMemo, useState } from "react";
import TurndownService from "turndown";

export interface MarkdownEditorProps {
  initialMarkdown: string;
  onSave: (md: string) => Promise<void>;
  onChange?: (md: string) => void;
}

type Mode = "rich" | "raw";

export function MarkdownEditor({
  initialMarkdown,
  onSave,
  onChange,
}: MarkdownEditorProps): JSX.Element {
  const [raw, setRaw] = useState<string>(initialMarkdown);
  const [mode, setMode] = useState<Mode>("rich");
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        class:
          "prose prose-invert prose-stone max-w-none min-h-[220px] p-5 focus:outline-none font-prose prose-headings:font-display prose-headings:tracking-tight-2 prose-headings:text-cream-2 prose-p:text-cream prose-p:leading-relaxed prose-strong:text-cream-2 prose-em:text-cream prose-code:text-vermilion-300 prose-code:bg-ink prose-code:px-1 prose-code:rounded prose-blockquote:border-l-vermilion prose-blockquote:text-cream/85 prose-blockquote:italic prose-a:text-vermilion-300 prose-a:underline-offset-4",
      },
    },
    onUpdate: ({ editor: e }) => {
      if (onChange) {
        const md = turndown.turndown(e.getHTML());
        onChange(md);
      }
    },
  });

  // Initialise editor content when initialMarkdown changes.
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

  const handleSwitchMode = (next: Mode) => {
    if (next === mode || !editor) return;
    if (next === "raw") {
      setRaw(turndown.turndown(editor.getHTML()));
    } else {
      editor.commands.setContent(marked.parse(raw) as string);
    }
    setMode(next);
  };

  const handleRawChange = (val: string) => {
    setRaw(val);
    if (onChange) onChange(val);
  };

  return (
    <div className="flex flex-col border border-rule rounded-sm overflow-hidden bg-ink">
      <header className="border-b border-rule px-4 py-2 flex items-center gap-3 bg-surface">
        <div
          className="inline-flex border border-rule rounded-sm overflow-hidden"
          role="tablist"
          aria-label="Editor mode"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "rich"}
            onClick={() => handleSwitchMode("rich")}
            className={`px-3 py-1 font-mono text-[10px] uppercase tracking-wide-3 transition-colors ${
              mode === "rich" ? "bg-vermilion text-cream-2" : "text-muted hover:text-cream"
            }`}
          >
            Rich
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "raw"}
            onClick={() => handleSwitchMode("raw")}
            className={`px-3 py-1 font-mono text-[10px] uppercase tracking-wide-3 border-l border-rule transition-colors ${
              mode === "raw" ? "bg-vermilion text-cream-2" : "text-muted hover:text-cream"
            }`}
          >
            Raw
          </button>
        </div>
        <div className="flex-1" />
        {error && (
          <span className="font-mono text-[10px] uppercase tracking-wide-3 text-vermilion-300">
            {error}
          </span>
        )}
        {savedMessage && (
          <span className="font-mono text-[10px] uppercase tracking-wide-3 text-teal animate-fade-up">
            ✓ {savedMessage}
          </span>
        )}
        <button type="button" onClick={handleSave} disabled={saving} className="btn-press">
          {saving ? "Saving…" : "Save"}
        </button>
      </header>

      {mode === "rich" && editor && (
        <>
          <Toolbar editor={editor} />
          <div className="flex-1 overflow-y-auto bg-ink">
            <EditorContent editor={editor} />
          </div>
        </>
      )}
      {mode === "raw" && (
        <textarea
          value={raw}
          onChange={(e) => handleRawChange(e.target.value)}
          className="flex-1 min-h-[220px] bg-ink text-cream font-mono text-sm p-5 focus:outline-none resize-none leading-relaxed"
        />
      )}
    </div>
  );
}

interface ToolbarProps {
  editor: ReturnType<typeof useEditor>;
}

function Toolbar({ editor }: ToolbarProps): JSX.Element | null {
  if (!editor) return null;
  return (
    <div className="border-b border-rule px-4 py-1.5 flex gap-0.5 bg-surface/60">
      <TButton
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        label="Heading 2"
      >
        <span className="font-display text-base leading-none">H2</span>
      </TButton>
      <TButton
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        label="Heading 3"
      >
        <span className="font-display text-sm leading-none">H3</span>
      </TButton>
      <Divider />
      <TButton
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
        label="Bold"
      >
        <b className="font-display">B</b>
      </TButton>
      <TButton
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        label="Italic"
      >
        <i className="font-display">I</i>
      </TButton>
      <TButton
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        label="Strikethrough"
      >
        <s className="font-display">S</s>
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
        <span className="font-mono-num">1.</span>
      </TButton>
      <TButton
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        label="Blockquote"
      >
        <span className="font-display">❝</span>
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
  return <div aria-hidden className="w-px h-5 bg-rule mx-1 self-center" />;
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
      className={`min-w-[2rem] h-7 px-2 rounded-sm text-xs flex items-center justify-center transition-colors ${
        active ? "bg-vermilion text-cream-2" : "text-cream/80 hover:bg-rule/40 hover:text-cream-2"
      }`}
    >
      {children}
    </button>
  );
}
