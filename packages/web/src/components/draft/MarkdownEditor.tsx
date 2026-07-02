import Link from "@tiptap/extension-link";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { marked } from "marked";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TurndownService from "turndown";
import { tables as gfmTables } from "turndown-plugin-gfm";

import { type InlineAction, inlineEdit } from "../../api/drafts";

export interface MarkdownEditorProps {
  initialMarkdown: string;
  /**
   * Persist the section. `createVersion` is true only for the first save of an
   * editing session (snapshots the pre-edit baseline); subsequent autosaves
   * pass false so debounced saves don't spam the version history.
   */
  onSave: (md: string, createVersion: boolean) => Promise<void>;
  /** Draft id — when set, the rich editor shows a floating AI toolbar on selection. */
  draftId?: string;
}

type Mode = "rich" | "raw";
type SaveStatus = "saved" | "dirty" | "saving" | "error";

const AUTOSAVE_MS = 1000;

export function MarkdownEditor({
  initialMarkdown,
  onSave,
  draftId,
}: MarkdownEditorProps): JSX.Element {
  const [raw, setRaw] = useState<string>(initialMarkdown);
  const [mode, setMode] = useState<Mode>("rich");
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState<string | null>(null);
  // Anchor for the floating AI toolbar; null when nothing is selected.
  const [aiAnchor, setAiAnchor] = useState<{ top: number; left: number } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const turndown = useMemo(() => {
    const td = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
    });
    // Without the GFM tables rule, turndown flattens an HTML <table> into
    // concatenated cell text — which is how generated comparison tables lost
    // all their formatting on the editor's save round-trip.
    td.use(gfmTables);
    return td;
  }, []);

  // Autosave bookkeeping. Refs (not state) because the editor's onUpdate is
  // bound once at creation and must read the freshest values at call time.
  const lastSavedRef = useRef(initialMarkdown); // last content we persisted or loaded
  const latestMdRef = useRef(initialMarkdown); // current editor content (rich or raw)
  const dirtyRef = useRef(false);
  const versionedRef = useRef(false); // did we snapshot this edit session's baseline yet?
  const applyingExternalRef = useRef(false); // suppress autosave during programmatic setContent
  const loadedRef = useRef(false); // has the initial content been loaded into the editor?
  const saveTimerRef = useRef<number | null>(null);
  const scheduleSaveRef = useRef<() => void>(() => {});

  const doSave = useCallback(async (): Promise<void> => {
    const content = latestMdRef.current;
    if (content === lastSavedRef.current) {
      dirtyRef.current = false;
      setStatus("saved");
      return;
    }
    setStatus("saving");
    setError(null);
    const createVersion = !versionedRef.current;
    try {
      await onSave(content, createVersion);
      lastSavedRef.current = content;
      versionedRef.current = true;
      dirtyRef.current = false;
      setStatus("saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error"); // stays dirty so a retry can re-save
    }
  }, [onSave]);

  const scheduleSave = useCallback((): void => {
    dirtyRef.current = true;
    setStatus("dirty");
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => void doSave(), AUTOSAVE_MS);
  }, [doSave]);
  scheduleSaveRef.current = scheduleSave;

  const editor = useEditor({
    // Table.* let the rich editor keep a markdown table as real table nodes
    // instead of dropping it (StarterKit has no table support).
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: "",
    editorProps: {
      attributes: {
        class: "prose-body max-w-none min-h-[200px] p-5 focus:outline-none",
      },
    },
    onUpdate: ({ editor: e }) => {
      if (applyingExternalRef.current) return; // programmatic setContent, not a user edit
      latestMdRef.current = turndown.turndown(e.getHTML());
      scheduleSaveRef.current();
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

  // Load the initial content once the editor is ready, then ONLY accept genuine
  // external changes (regenerate/revise/refetch): never clobber unsaved local
  // edits, and ignore the echo of our own just-saved content (which would reset
  // the cursor mid-typing because section saves replace the whole draft state).
  useEffect(() => {
    if (!editor) return;
    const applyExternal = (md: string): void => {
      applyingExternalRef.current = true;
      editor.commands.setContent(marked.parse(md) as string);
      applyingExternalRef.current = false;
      setRaw(md);
      latestMdRef.current = md;
      lastSavedRef.current = md;
    };
    if (!loadedRef.current) {
      loadedRef.current = true;
      applyExternal(initialMarkdown);
      return;
    }
    if (initialMarkdown === lastSavedRef.current) return; // our own save echoed back
    if (dirtyRef.current) return; // protect unsaved local edits
    applyExternal(initialMarkdown);
    versionedRef.current = false; // a fresh baseline → next edit snapshots it
    setStatus("saved");
  }, [initialMarkdown, editor]);

  // Warn before leaving the page with an unsaved or in-flight edit.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      if (dirtyRef.current || status === "saving") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [status]);

  // Flush a pending autosave on unmount (best-effort; no setState after unmount).
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      if (dirtyRef.current && latestMdRef.current !== lastSavedRef.current) {
        void onSave(latestMdRef.current, !versionedRef.current).catch(() => {});
      }
    };
  }, [onSave]);

  const handleSwitchMode = (next: Mode): void => {
    if (next === mode || !editor) return;
    if (next === "raw") {
      const md = turndown.turndown(editor.getHTML());
      setRaw(md);
      latestMdRef.current = md;
    } else {
      applyingExternalRef.current = true;
      editor.commands.setContent(marked.parse(raw) as string);
      applyingExternalRef.current = false;
      latestMdRef.current = raw;
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
        // insertContentAt fires onUpdate → the edit is marked dirty and autosaved.
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
    latestMdRef.current = val;
    scheduleSave();
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
        {error ? (
          <span
            className="text-xs text-rose-ink flex items-center gap-1.5 max-w-[260px]"
            title={error}
          >
            <span className="truncate">{error}</span>
            {status === "error" && (
              <button
                type="button"
                onClick={() => void doSave()}
                className="shrink-0 underline underline-offset-2 hover:no-underline"
              >
                Retry
              </button>
            )}
          </span>
        ) : (
          <SaveStatusLabel status={status} />
        )}
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

function SaveStatusLabel({ status }: { status: SaveStatus }): JSX.Element | null {
  if (status === "saving") return <span className="text-xs text-muted">Saving…</span>;
  if (status === "dirty") return <span className="text-xs text-muted">Unsaved changes…</span>;
  if (status === "saved")
    return <span className="text-xs text-leaf font-medium animate-fade-in">✓ Saved</span>;
  return null;
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
