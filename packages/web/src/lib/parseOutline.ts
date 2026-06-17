export interface ParsedSection {
  title: string;
  brief: string;
}
export interface ParsedOutline {
  title: string;
  sections: ParsedSection[];
}

const H1_RE = /^#\s+(.+?)\s*$/;
const H_RE = /^#{2,3}\s+(.+?)\s*$/; // H2/H3 → section
// A top-level bullet: no leading whitespace, then -, * or "N." then text.
const TOP_BULLET_RE = /^(?:[-*]|\d+\.)\s+(.+?)\s*$/;

function stripMarkers(line: string): string {
  return line
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/^\s*(?:[-*]|\d+\.)\s+/, "")
    .trim();
}

/**
 * Parse a pasted outline (markdown headings, bullets, numbered list, or plain
 * lines) into a title + ordered sections. Honors the user's structure exactly;
 * no network, no LLM.
 */
export function parseOutline(text: string): ParsedOutline {
  const rawLines = text.split("\n");
  const nonEmpty = rawLines.filter((l) => l.trim() !== "");
  if (nonEmpty.length === 0) return { title: "", sections: [] };

  // Title: first H1 if present, else the first non-empty line (markers stripped).
  let title = "";
  let titleIdx = -1;
  for (let i = 0; i < rawLines.length; i++) {
    const m = H1_RE.exec(rawLines[i].trim());
    if (m) {
      title = m[1].trim();
      titleIdx = i;
      break;
    }
  }
  if (titleIdx === -1) {
    titleIdx = rawLines.findIndex((l) => l.trim() !== "");
    title = stripMarkers(rawLines[titleIdx]);
  }

  // Sections: H2/H3 or top-level (unindented) bullets after the title line.
  const sections: ParsedSection[] = [];
  const briefLines: string[][] = [];
  const isSection = (line: string): string | null => {
    const h = H_RE.exec(line.trim());
    if (h) return h[1].trim();
    if (/^\S/.test(line)) {
      const b = TOP_BULLET_RE.exec(line);
      if (b) return b[1].trim();
    }
    return null;
  };

  let sawMarker = false;
  for (let i = titleIdx + 1; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (line.trim() === "") continue;
    const sec = isSection(line);
    if (sec !== null) {
      sawMarker = true;
      sections.push({ title: sec, brief: "" });
      briefLines.push([]);
    } else if (sections.length > 0) {
      briefLines[briefLines.length - 1].push(stripMarkers(line));
    }
  }

  // Fallback: no markers at all → each remaining non-empty line is a section.
  if (!sawMarker) {
    for (let i = titleIdx + 1; i < rawLines.length; i++) {
      const line = rawLines[i];
      if (line.trim() === "") continue;
      sections.push({ title: stripMarkers(line), brief: "" });
      briefLines.push([]);
    }
  }

  for (let i = 0; i < sections.length; i++) {
    sections[i].brief = briefLines[i].join("\n").trim();
  }
  return { title, sections };
}
