export const AUTOMATON_SPEC_VERSION: number;
export const AUTOMATON_LIMITS: Readonly<Record<string, number>>;
export const EPSILON: string;

export interface AutomatonModel {
  v: number;
  type: 'dfa' | 'nfa';
  title: string;
  states: string[];
  alphabet: string[];
  start: string;
  accepting: string[];
  transitions: Array<{ from: string; symbol: string; to: string }>;
  notes: string[];
}

export function validateAutomaton(spec: unknown): { ok: true; model: AutomatonModel } | { ok: false; code: string; message: string };
export function automatonAccepts(model: AutomatonModel, word: Iterable<string>): boolean;
export function automatonToMermaid(model: AutomatonModel): string;
export function describeAutomaton(model: AutomatonModel): string;
export function automatonTable(model: AutomatonModel): { columns: string[]; rows: string[][] };
