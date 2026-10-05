// src/components/onboarding/i18nText.tsx
//
// Placeholders for the welcome, tour and demo strings (src/i18n.onboarding.ts).
// The translation carries the {slot}, so word order follows the language: the
// step counter reads "Step 2 of 3" in English and "第 2 步，共 3 步" in Chinese.

import React from 'react';
import { useLanguage } from '../../i18n';

/** A translated string with {slot} placeholders replaced by plain text. */
export function fmt(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
}

/** The same, for slots that are elements (keycaps, links). */
export function fillText(text: string, slots: Record<string, React.ReactNode>): React.ReactNode[] {
  return text.split(/(\{\w+\})/).map((part, i) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    return name && name in slots ? <React.Fragment key={i}>{slots[name]}</React.Fragment> : part;
  });
}

/**
 * The words an answer or a caption is revealed by. Spaced languages split on
 * spaces and join with one; Chinese and Japanese have no spaces, so they are
 * split by Intl.Segmenter (in Chromium) and joined with nothing.
 */
export function useWordSplitter(): (text: string) => { words: string[]; sep: string } {
  const { lang } = useLanguage();
  return React.useCallback((text: string) => {
    if ((lang === 'zh' || lang === 'ja') && typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
      const seg = new Intl.Segmenter(lang, { granularity: 'word' });
      return { words: Array.from(seg.segment(text), s => s.segment), sep: '' };
    }
    return { words: text.split(' '), sep: ' ' };
  }, [lang]);
}
