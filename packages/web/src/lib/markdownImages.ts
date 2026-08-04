export interface EmbeddedImageCleanup {
  text: string;
  removedImages: number;
  removedCharacters: number;
}

const FALLBACK_ALT = "embedded image";

function placeholder(alt: string): string {
  const usefulAlt = alt.trim() || FALLBACK_ALT;
  return `[Image omitted during import: ${usefulAlt}]`;
}

function normalizeReferenceLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

export function stripEmbeddedImages(markdown: string): EmbeddedImageCleanup {
  let removedImages = 0;
  let removedCharacters = 0;
  const embeddedReferenceLabels = new Set<string>();

  let text = markdown.replace(
    /^ {0,3}\[([^\]]+)\]:[ \t]*<?data:image\/[^\s>]+>?(?:[ \t]+.*)?(?:\r?\n|$)/gim,
    (definition, label: string) => {
      embeddedReferenceLabels.add(normalizeReferenceLabel(label));
      removedImages += 1;
      removedCharacters += definition.replace(/\r?\n$/, "").length;
      return "";
    },
  );

  text = text.replace(/!\[([^\]]*)\]\[([^\]]*)\]/g, (image, alt: string, label: string) => {
    const referenceLabel = normalizeReferenceLabel(label || alt);
    return embeddedReferenceLabels.has(referenceLabel) ? placeholder(alt) : image;
  });

  text = text.replace(
    /!\[([^\]]*)\]\(\s*<?data:image\/[^)\s>]+>?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/gi,
    (image, alt: string) => {
      removedImages += 1;
      removedCharacters += image.length;
      return placeholder(alt);
    },
  );

  text = text.replace(/<img\b(?=[^>]*\bsrc\s*=\s*(['"])data:image\/)[^>]*>/gi, (image) => {
    const alt = /\balt\s*=\s*(['"])(.*?)\1/i.exec(image)?.[2] ?? "";
    removedImages += 1;
    removedCharacters += image.length;
    return placeholder(alt);
  });

  return { text, removedImages, removedCharacters };
}
