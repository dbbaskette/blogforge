import { api } from "./client";

export interface HelpPattern {
  title: string;
  body: string;
}
export interface HelpLens {
  key: string;
  title: string;
  points: string[];
}
export interface HelpLever {
  key: string;
  label: string;
  weight: number;
  impact: string;
  detection: "structural" | "judgment";
}
export interface HelpRules {
  humanize: {
    words: string[];
    phrases: string[];
    sentence_starters: string[];
    patterns: HelpPattern[];
    lenses: HelpLens[];
  };
  geo: { levers: HelpLever[] };
}

export function getHelpRules(): Promise<HelpRules> {
  return api("/api/help/rules");
}
