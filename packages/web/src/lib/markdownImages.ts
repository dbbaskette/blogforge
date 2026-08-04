export interface EmbeddedImageCleanup {
  text: string;
  removedImages: number;
  removedCharacters: number;
}

interface Fence {
  marker: "`" | "~";
  length: number;
}

const FALLBACK_ALT = "embedded image";
const DATA_IMAGE_PREFIX = "data:image/";

function placeholder(alt: string): string {
  const usefulAlt = alt.trim() || FALLBACK_ALT;
  return `[Image omitted during import: ${usefulAlt}]`;
}

function normalizeReferenceLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

function startsWithCaseInsensitive(text: string, prefix: string, start: number): boolean {
  return text.slice(start, start + prefix.length).toLowerCase() === prefix;
}

function isImageCandidate(text: string, position: number): boolean {
  if (text.startsWith("![", position)) return true;
  return (
    startsWithCaseInsensitive(text, "<img", position) &&
    position + 4 < text.length &&
    (/\s/.test(text[position + 4]) || "/>".includes(text[position + 4]))
  );
}

interface ScanEnd {
  end?: number;
  recovery?: number;
}

function findImageClosingBracket(text: string, start: number, end: number): ScanEnd {
  let position = start;
  let crossedLine = false;
  while (position < end) {
    if (crossedLine && isImageCandidate(text, position)) return { recovery: position };
    if (text[position] === "\\" && position + 1 < end) {
      position += 2;
    } else if (text[position] === "]") {
      return { end: position };
    } else {
      if (text[position] === "\n") crossedLine = true;
      position += 1;
    }
  }
  return {};
}

function findLaterLineImageCandidate(
  text: string,
  start: number,
  end: number,
  crossedLine: boolean,
): number | undefined {
  let position = start;
  let canRecover = crossedLine;
  while (position < end) {
    if (canRecover && isImageCandidate(text, position)) return position;
    if (text[position] === "\n") canRecover = true;
    position += 1;
  }
  return undefined;
}

function findClosingBracket(text: string, start: number, end: number): number | undefined {
  let position = start;
  while (position < end) {
    if (text[position] === "\\" && position + 1 < end) {
      position += 2;
    } else if (text[position] === "]") {
      return position;
    } else {
      position += 1;
    }
  }
  return undefined;
}

function readableAlt(alt: string): string {
  const parts: string[] = [];
  let position = 0;
  while (position < alt.length) {
    if (alt[position] === "\\" && position + 1 < alt.length && alt[position + 1] === "]") {
      parts.push("]");
      position += 2;
    } else {
      parts.push(alt[position]);
      position += 1;
    }
  }
  return parts.join("");
}

function fenceRun(line: string): Fence | undefined {
  let position = 0;
  while (position < line.length && position < 3 && line[position] === " ") position += 1;
  if (position >= line.length || (line[position] !== "`" && line[position] !== "~")) {
    return undefined;
  }
  const marker = line[position] as Fence["marker"];
  let runEnd = position;
  while (runEnd < line.length && line[runEnd] === marker) runEnd += 1;
  const length = runEnd - position;
  return length >= 3 ? { marker, length } : undefined;
}

function isClosingFence(line: string, fence: Fence): boolean {
  const run = fenceRun(line);
  if (!run || run.marker !== fence.marker || run.length < fence.length) return false;
  let position = 0;
  while (position < line.length && position < 3 && line[position] === " ") position += 1;
  position += run.length;
  while (position < line.length) {
    if (line[position] !== " " && line[position] !== "\t") return false;
    position += 1;
  }
  return true;
}

function lineContent(line: string): string {
  let end = line.length;
  if (end > 0 && line[end - 1] === "\n") end -= 1;
  if (end > 0 && line[end - 1] === "\r") end -= 1;
  return line.slice(0, end);
}

function referenceDefinitionLabel(line: string): string | undefined {
  let position = 0;
  while (position < line.length && position < 3 && line[position] === " ") position += 1;
  if (position >= line.length || line[position] !== "[") return undefined;

  const labelStart = position + 1;
  const labelEnd = findClosingBracket(line, labelStart, line.length);
  if (labelEnd === undefined || labelEnd === labelStart) return undefined;
  position = labelEnd + 1;
  if (position >= line.length || line[position] !== ":") return undefined;
  position += 1;
  while (position < line.length && (line[position] === " " || line[position] === "\t")) {
    position += 1;
  }

  if (position < line.length && line[position] === "<") position += 1;
  if (!startsWithCaseInsensitive(line, DATA_IMAGE_PREFIX, position)) return undefined;
  position += DATA_IMAGE_PREFIX.length;
  const payloadStart = position;
  while (position < line.length && !/\s/.test(line[position]) && line[position] !== ">") {
    position += 1;
  }
  if (position === payloadStart) return undefined;
  if (position < line.length && line[position] === ">") position += 1;
  if (position < line.length && line[position] !== " " && line[position] !== "\t") {
    return undefined;
  }
  return readableAlt(line.slice(labelStart, labelEnd));
}

function removeReferenceDefinitions(markdown: string): {
  text: string;
  labels: Set<string>;
  removedImages: number;
  removedCharacters: number;
} {
  const parts: string[] = [];
  const labels = new Set<string>();
  let removedImages = 0;
  let removedCharacters = 0;
  let fence: Fence | undefined;
  let lineStart = 0;

  while (lineStart < markdown.length) {
    const newline = markdown.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? markdown.length : newline + 1;
    const line = markdown.slice(lineStart, lineEnd);
    const content = lineContent(line);

    if (fence) {
      parts.push(line);
      if (isClosingFence(content, fence)) fence = undefined;
    } else {
      const opening = fenceRun(content);
      if (opening) {
        fence = opening;
        parts.push(line);
      } else {
        const label = referenceDefinitionLabel(content);
        if (label === undefined) {
          parts.push(line);
        } else {
          labels.add(normalizeReferenceLabel(label));
          removedImages += 1;
          removedCharacters += content.length;
        }
      }
    }
    lineStart = lineEnd;
  }

  return { text: parts.join(""), labels, removedImages, removedCharacters };
}

function inlineDataImageEnd(
  text: string,
  openParen: number,
  end: number,
): { isData: boolean; imageEnd?: number; recovery?: number } {
  let position = openParen + 1;
  let crossedLine = false;
  while (position < end && /\s/.test(text[position])) {
    if (text[position] === "\n") crossedLine = true;
    position += 1;
  }
  if (crossedLine && isImageCandidate(text, position)) {
    return { isData: false, recovery: position };
  }
  if (position < end && text[position] === "<") position += 1;
  if (!startsWithCaseInsensitive(text, DATA_IMAGE_PREFIX, position)) return { isData: false };

  position += DATA_IMAGE_PREFIX.length;
  const payloadStart = position;
  while (
    position < end &&
    !/\s/.test(text[position]) &&
    text[position] !== ")" &&
    text[position] !== ">"
  ) {
    position += 1;
  }
  if (position === payloadStart) return { isData: false };
  if (position < end && text[position] === ">") position += 1;
  if (position < end && text[position] === ")") return { isData: true, imageEnd: position + 1 };

  while (position < end && /\s/.test(text[position])) {
    if (text[position] === "\n") crossedLine = true;
    position += 1;
  }
  if (crossedLine && isImageCandidate(text, position)) {
    return { isData: true, recovery: position };
  }
  if (position >= end) return { isData: true };

  const delimiter = text[position];
  if (delimiter === '"' || delimiter === "'") {
    position += 1;
    let closed = false;
    while (position < end) {
      if (crossedLine && isImageCandidate(text, position)) {
        return { isData: true, recovery: position };
      }
      if (text[position] === "\\" && position + 1 < end) {
        position += 2;
      } else if (text[position] === delimiter) {
        position += 1;
        closed = true;
        break;
      } else {
        if (text[position] === "\n") crossedLine = true;
        position += 1;
      }
    }
    if (!closed) return { isData: true };
  } else if (delimiter === "(") {
    position += 1;
    while (position < end && text[position] !== ")") {
      if (crossedLine && isImageCandidate(text, position)) {
        return { isData: true, recovery: position };
      }
      if (text[position] === "\n") crossedLine = true;
      position += 1;
    }
    if (position >= end) return { isData: true };
    position += 1;
  } else {
    return {
      isData: true,
      recovery: findLaterLineImageCandidate(text, position, end, crossedLine),
    };
  }

  while (position < end && /\s/.test(text[position])) {
    if (text[position] === "\n") crossedLine = true;
    position += 1;
  }
  if (crossedLine && isImageCandidate(text, position)) {
    return { isData: true, recovery: position };
  }
  return position < end && text[position] === ")"
    ? { isData: true, imageEnd: position + 1 }
    : {
        isData: true,
        recovery: findLaterLineImageCandidate(text, position, end, crossedLine),
      };
}

function htmlImageEnd(text: string, start: number, end: number): ScanEnd {
  let position = start + 4;
  let quote: string | undefined;
  let crossedLine = false;
  while (position < end) {
    if (crossedLine && isImageCandidate(text, position)) return { recovery: position };
    const character = text[position];
    if (quote) {
      if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return { end: position + 1 };
    }
    if (character === "\n") crossedLine = true;
    position += 1;
  }
  return {};
}

function htmlImageAttributes(image: string): { alt?: string; hasDataSource: boolean } {
  let alt: string | undefined;
  let hasDataSource = false;
  let position = 4;
  const tagEnd = image.length - 1;

  while (position < tagEnd) {
    while (position < tagEnd && (/\s/.test(image[position]) || image[position] === "/")) {
      position += 1;
    }
    const nameStart = position;
    while (position < tagEnd && !/\s/.test(image[position]) && !"=/>".includes(image[position])) {
      position += 1;
    }
    if (position === nameStart) {
      position += 1;
      continue;
    }
    const name = image.slice(nameStart, position).toLowerCase();
    while (position < tagEnd && /\s/.test(image[position])) position += 1;
    if (position >= tagEnd || image[position] !== "=") continue;
    position += 1;
    while (position < tagEnd && /\s/.test(image[position])) position += 1;

    let value: string;
    if (position < tagEnd && (image[position] === '"' || image[position] === "'")) {
      const quote = image[position];
      position += 1;
      const valueStart = position;
      while (position < tagEnd && image[position] !== quote) position += 1;
      value = image.slice(valueStart, position);
      if (position < tagEnd) position += 1;
    } else {
      const valueStart = position;
      while (position < tagEnd && !/\s/.test(image[position]) && image[position] !== ">") {
        position += 1;
      }
      value = image.slice(valueStart, position);
    }

    if (name === "alt" && alt === undefined) alt = value;
    else if (name === "src" && value.toLowerCase().startsWith(DATA_IMAGE_PREFIX)) {
      hasDataSource = true;
    }
  }

  return { alt, hasDataSource };
}

function replaceImagesInText(
  text: string,
  embeddedReferenceLabels: Set<string>,
): EmbeddedImageCleanup {
  const parts: string[] = [];
  let removedImages = 0;
  let removedCharacters = 0;
  let position = 0;

  while (position < text.length) {
    if (text.startsWith("![", position)) {
      const altStart = position + 2;
      const altScan = findImageClosingBracket(text, altStart, text.length);
      if (altScan.end === undefined) {
        if (altScan.recovery !== undefined) {
          parts.push(text.slice(position, altScan.recovery));
          position = altScan.recovery;
          continue;
        }
        parts.push(text.slice(position));
        break;
      }
      const altEnd = altScan.end;
      const readable = readableAlt(text.slice(altStart, altEnd));
      const afterAlt = altEnd + 1;

      if (afterAlt < text.length && text[afterAlt] === "(") {
        const inline = inlineDataImageEnd(text, afterAlt, text.length);
        if (inline.recovery !== undefined) {
          parts.push(text.slice(position, inline.recovery));
          position = inline.recovery;
          continue;
        }
        if (inline.isData && inline.imageEnd === undefined) {
          parts.push(text.slice(position));
          break;
        }
        if (inline.isData && inline.imageEnd !== undefined) {
          parts.push(placeholder(readable));
          removedImages += 1;
          removedCharacters += inline.imageEnd - position;
          position = inline.imageEnd;
          continue;
        }
      } else if (afterAlt < text.length && text[afterAlt] === "[") {
        const labelStart = afterAlt + 1;
        const labelScan = findImageClosingBracket(text, labelStart, text.length);
        if (labelScan.end === undefined) {
          if (labelScan.recovery !== undefined) {
            parts.push(text.slice(position, labelScan.recovery));
            position = labelScan.recovery;
            continue;
          }
          parts.push(text.slice(position));
          break;
        }
        const labelEnd = labelScan.end;
        const label = text.slice(labelStart, labelEnd) || readable;
        const imageEnd = labelEnd + 1;
        if (embeddedReferenceLabels.has(normalizeReferenceLabel(readableAlt(label)))) {
          parts.push(placeholder(readable));
        } else {
          parts.push(text.slice(position, imageEnd));
        }
        position = imageEnd;
        continue;
      } else if (readable && embeddedReferenceLabels.has(normalizeReferenceLabel(readable))) {
        parts.push(placeholder(readable));
        position = afterAlt;
        continue;
      }

      parts.push(text.slice(position, afterAlt));
      position = afterAlt;
      continue;
    }

    if (
      startsWithCaseInsensitive(text, "<img", position) &&
      position + 4 < text.length &&
      (/\s/.test(text[position + 4]) || "/>".includes(text[position + 4]))
    ) {
      const imageScan = htmlImageEnd(text, position, text.length);
      if (imageScan.end === undefined) {
        if (imageScan.recovery !== undefined) {
          parts.push(text.slice(position, imageScan.recovery));
          position = imageScan.recovery;
          continue;
        }
        parts.push(text.slice(position));
        break;
      }
      const imageEnd = imageScan.end;
      const image = text.slice(position, imageEnd);
      const { alt, hasDataSource } = htmlImageAttributes(image);
      if (hasDataSource) {
        parts.push(placeholder(alt ?? ""));
        removedImages += 1;
        removedCharacters += image.length;
      } else {
        parts.push(image);
      }
      position = imageEnd;
      continue;
    }

    parts.push(text[position]);
    position += 1;
  }

  return { text: parts.join(""), removedImages, removedCharacters };
}

function replaceImages(markdown: string, labels: Set<string>): EmbeddedImageCleanup {
  const parts: string[] = [];
  let removedImages = 0;
  let removedCharacters = 0;
  let fence: Fence | undefined;
  let lineStart = 0;
  let outsideStart = 0;

  const appendOutside = (end: number): void => {
    if (outsideStart >= end) return;
    const replaced = replaceImagesInText(markdown.slice(outsideStart, end), labels);
    parts.push(replaced.text);
    removedImages += replaced.removedImages;
    removedCharacters += replaced.removedCharacters;
  };

  while (lineStart < markdown.length) {
    const newline = markdown.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? markdown.length : newline + 1;
    const line = markdown.slice(lineStart, lineEnd);
    const content = lineContent(line);

    if (fence) {
      parts.push(line);
      if (isClosingFence(content, fence)) {
        fence = undefined;
        outsideStart = lineEnd;
      }
    } else {
      const opening = fenceRun(content);
      if (opening) {
        appendOutside(lineStart);
        fence = opening;
        parts.push(line);
      }
    }
    lineStart = lineEnd;
  }

  if (!fence) appendOutside(markdown.length);

  return { text: parts.join(""), removedImages, removedCharacters };
}

export function stripEmbeddedImages(markdown: string): EmbeddedImageCleanup {
  const definitions = removeReferenceDefinitions(markdown);
  const images = replaceImages(definitions.text, definitions.labels);
  return {
    text: images.text,
    removedImages: definitions.removedImages + images.removedImages,
    removedCharacters: definitions.removedCharacters + images.removedCharacters,
  };
}
