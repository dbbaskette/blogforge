export interface EmbeddedImageCleanup {
  text: string;
  removedImages: number;
  removedCharacters: number;
}

const FALLBACK_ALT = "embedded image";
const HTML_DATA_IMAGE_SRC = /(?:^|\s)src\s*=\s*(?:['"]data:image\/|data:image\/[^\s>]+)/i;
const HTML_ALT_ATTRIBUTE = /(?:^|\s)alt\s*=\s*(?:['"]([^'"]*)['"]|([^\s>]+))/i;

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

  text = text.replace(/!\[([^\]]+)\](?![\[(])/g, (image, alt: string) => {
    return embeddedReferenceLabels.has(normalizeReferenceLabel(alt)) ? placeholder(alt) : image;
  });

  text = text.replace(
    /!\[([^\]]*)\]\(\s*<?data:image\/[^)\s>]+>?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/gi,
    (image, alt: string) => {
      removedImages += 1;
      removedCharacters += image.length;
      return placeholder(alt);
    },
  );

  text = text.replace(/<img\b[^>]*>/gi, (image) => {
    if (!HTML_DATA_IMAGE_SRC.test(image)) return image;
    const altMatch = HTML_ALT_ATTRIBUTE.exec(image);
    const alt = altMatch?.[1] ?? altMatch?.[2] ?? "";
    removedImages += 1;
    removedCharacters += image.length;
    return placeholder(alt);
  });

  return { text, removedImages, removedCharacters };
}
