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
        class: "prose prose-invert prose-slate max-w-none min-h-[200px] p-4 focus:outline-none",
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
    <div className="flex flex-col border border-slate-700 rounded overflow-hidden">
      <header className="border-b border-slate-800 px-4 py-2 flex items-center gap-3 bg-slate-900/50">
        <div className="inline-flex bg-slate-800 rounded p-0.5">
          <button
            type="button"
            onClick={() => handleSwitchMode("rich")}
            className={`px-3 py-1 text-xs rounded ${
              mode === "rich" ? "bg-slate-700 text-slate-100" : "text-slate-400"
            }`}
          >
            Rich
          </button>
          <button
            type="button"
            onClick={() => handleSwitchMode("raw")}
            className={`px-3 py-1 text-xs rounded ${
              mode === "raw" ? "bg-slate-700 text-slate-100" : "text-slate-400"
            }`}
          >
            Raw
          </button>
        </div>
        <div className="flex-1" />
        {error && <span className="text-red-400 text-xs">{error}</span>}
        {savedMessage && <span className="text-emerald-400 text-xs">{savedMessage}</span>}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1 text-xs rounded bg-blue-600 text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </header>

      {mode === "rich" && editor && (
        <>
          <Toolbar editor={editor} />
          <div className="flex-1 overflow-y-auto bg-slate-950">
            <EditorContent editor={editor} />
          </div>
        </>
      )}
      {mode === "raw" && (
        <textarea
          value={raw}
          onChange={(e) => handleRawChange(e.target.value)}
          className="flex-1 min-h-[200px] bg-slate-950 text-slate-200 font-mono text-sm p-4 focus:outline-none resize-none"
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
    <div className="border-b border-slate-800 px-4 py-2 flex gap-1 bg-slate-900/30 text-sm">
      <TButton
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        H2
      </TButton>
      <TButton
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        H3
      </TButton>
      <div className="w-px h-5 bg-slate-700 mx-1" />
      <TButton
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <b>B</b>
      </TButton>
      <TButton
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <i>I</i>
      </TButton>
      <TButton
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <s>S</s>
      </TButton>
      <div className="w-px h-5 bg-slate-700 mx-1" />
      <TButton
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        •
      </TButton>
      <TButton
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        1.
      </TButton>
      <TButton
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        ❝
      </TButton>
      <TButton
        active={editor.isActive("code")}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        {"<>"}
      </TButton>
    </div>
  );
}

interface TButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function TButton({ active, onClick, children }: TButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-1 rounded text-xs ${
        active ? "bg-slate-700 text-slate-100" : "text-slate-300 hover:bg-slate-800"
      }`}
    >
      {children}
    </button>
  );
}
