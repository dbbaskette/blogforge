/**
 * TipTap extension that highlights text runs in the editor. Pure view chrome —
 * it adds inline ProseMirror decorations over matching substrings and never
 * touches the document, so autosave / turndown round-trips are unaffected.
 *
 * Three kinds, distinguished by CSS class:
 *   - `pending`      — a panel-applied edit not yet approved (legacy tracked-changes)
 *   - `under-review` — a fix just applied and awaiting accept (review state)
 *   - `locate`       — a transient highlight from the "Highlight" action
 *
 * Runs live in the plugin's state, updated by dispatching a transaction with
 * `setMeta(trackedChangeKey, runs)`. Decorations are rebuilt from the current
 * doc on every view update, so they stay correct as the writer types.
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Extension } from "@tiptap/react";

export type TrackedChangeKind = "pending" | "under-review" | "locate";

export interface TrackedRun {
  text: string;
  kind: TrackedChangeKind;
}

/** Meta may be a bare string[] (legacy → "pending") or typed runs. */
export type TrackedChangeMeta = string[] | TrackedRun[];

export const trackedChangeKey = new PluginKey<TrackedRun[]>("trackedChange");

function normalize(meta: TrackedChangeMeta | undefined): TrackedRun[] {
  if (!meta) return [];
  return meta.map((m) => (typeof m === "string" ? { text: m, kind: "pending" as const } : m));
}

export function buildDecorations(doc: PMNode, runs: TrackedRun[]): DecorationSet {
  const clean = runs
    .map((r) => ({ text: r.text.trim(), kind: r.kind }))
    .filter((r) => r.text.length > 0)
    // Longest first so a longer run wins over a shorter one it contains.
    .sort((a, b) => b.text.length - a.text.length);
  if (clean.length === 0) return DecorationSet.empty;

  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text;
    for (const run of clean) {
      let idx = text.indexOf(run.text);
      while (idx !== -1) {
        decos.push(
          Decoration.inline(pos + idx, pos + idx + run.text.length, {
            class: `tracked-change tracked-change--${run.kind}`,
          }),
        );
        idx = text.indexOf(run.text, idx + run.text.length);
      }
    }
  });
  return DecorationSet.create(doc, decos);
}

export const TrackedChangeDecoration = Extension.create({
  name: "trackedChange",
  addProseMirrorPlugins() {
    return [
      new Plugin<TrackedRun[]>({
        key: trackedChangeKey,
        state: {
          init: () => [],
          apply(tr, old) {
            const meta = tr.getMeta(trackedChangeKey) as TrackedChangeMeta | undefined;
            return meta === undefined ? old : normalize(meta);
          },
        },
        props: {
          decorations(state) {
            const runs = trackedChangeKey.getState(state) ?? [];
            return buildDecorations(state.doc, runs);
          },
        },
      }),
    ];
  },
});
