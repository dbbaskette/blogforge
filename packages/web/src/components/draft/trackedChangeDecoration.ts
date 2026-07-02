/**
 * TipTap extension that colors "pending" text runs (panel-applied edits not yet
 * approved). Pure view chrome — it adds inline ProseMirror decorations over the
 * matching substrings and never touches the document, so autosave / turndown
 * round-trips are unaffected.
 *
 * The runs to color live in the plugin's state, updated by dispatching a
 * transaction with `setMeta(trackedChangeKey, texts)`. Decorations are rebuilt
 * from the current doc on every view update, so they stay correct as the writer
 * types (no offset mapping to get wrong).
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Extension } from "@tiptap/react";

export const trackedChangeKey = new PluginKey<string[]>("trackedChange");

function buildDecorations(doc: PMNode, texts: string[]): DecorationSet {
  const runs = [...new Set(texts.map((t) => t.trim()).filter((t) => t.length > 0))]
    // Longest first so a longer run wins over a shorter one it contains.
    .sort((a, b) => b.length - a.length);
  if (runs.length === 0) return DecorationSet.empty;

  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text;
    for (const run of runs) {
      let idx = text.indexOf(run);
      while (idx !== -1) {
        decos.push(
          Decoration.inline(pos + idx, pos + idx + run.length, { class: "tracked-change" }),
        );
        idx = text.indexOf(run, idx + run.length);
      }
    }
  });
  return DecorationSet.create(doc, decos);
}

export const TrackedChangeDecoration = Extension.create({
  name: "trackedChange",
  addProseMirrorPlugins() {
    return [
      new Plugin<string[]>({
        key: trackedChangeKey,
        state: {
          init: () => [],
          apply(tr, old) {
            const meta = tr.getMeta(trackedChangeKey) as string[] | undefined;
            return meta ?? old;
          },
        },
        props: {
          decorations(state) {
            const texts = trackedChangeKey.getState(state) ?? [];
            return buildDecorations(state.doc, texts);
          },
        },
      }),
    ];
  },
});
