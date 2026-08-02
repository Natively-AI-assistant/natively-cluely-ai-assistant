const LANGUAGE_ALIASES = {
  javascript: ['javascript', 'js'],
  typescript: ['typescript', 'ts'],
  python: ['python', 'py'],
};

export function extractCode(responseText, language) {
  if (!responseText || !responseText.trim()) return null;
  const fenceRe = /```([a-zA-Z0-9]*)\n([\s\S]*?)```/g;
  const blocks = [...responseText.matchAll(fenceRe)].map((m) => ({ tag: m[1].toLowerCase(), code: m[2] }));
  if (blocks.length === 0) return responseText;

  const aliases = LANGUAGE_ALIASES[language] || [language];
  const tagged = blocks.find((b) => aliases.includes(b.tag));
  if (tagged) return tagged.code;

  const untagged = blocks.find((b) => b.tag === '');
  if (untagged) return untagged.code;

  return blocks[0].code;
}
