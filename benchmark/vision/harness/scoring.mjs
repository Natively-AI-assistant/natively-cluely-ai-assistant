// Scoring, shared by run.mjs and rescore.mjs.
//
// `onLine(n, spec)` scopes a check to the model's answer line for question n.
// Without it a check like /\b3\b/ ("how many?") is satisfied by the "3." the
// model uses to number its own third answer — which silently scored two wrong
// chart answers as correct on 2026-09-17. Anything whose answer is a short
// discrete value must be line-scoped.
export const near = (target, tol) => ({ num: true, target, tol })
export const onLine = (line, spec) => ({ line, spec })

// The span of the answer to question `n`: from its marker up to the next one.
//
// Markers are found ANYWHERE, not just at line start: models answer both as
// "1. x\n2. y" and as "(1) x (2) y" on a single line, and an earlier version of
// this function only understood the first form — scoring a correct packed answer
// as two misses. A marker must be preceded by start-of-string or whitespace/
// punctuation so a decimal like "2.5" or a date can't be mistaken for one.
export function answerLine(text, n) {
  const markers = [...text.matchAll(/(?:^|[\s;,·—-])\(?(\d{1,2})\)?[.):]\s/g)]
    .map((m) => ({ n: Number(m[1]), start: m.index + m[0].length }))
  const mine = markers.find((m) => m.n === n)
  if (mine) {
    const next = markers.find((m) => m.start > mine.start && m.n === n + 1)
      ?? markers.find((m) => m.start > mine.start && m.n > n)
    return text.slice(mine.start, next ? next.start : undefined)
  }
  const lines = text.split('\n').filter((l) => l.trim())
  return lines[n - 1] ?? ''      // fall back to positional lines when unnumbered
}

export function checkOne(spec, text) {
  if (spec?.line) return checkOne(spec.spec, answerLine(text, spec.line))
  if (spec instanceof RegExp) return spec.test(text)
  const nums = [...text.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, '')))
  return nums.some((n) => Math.abs(n - spec.target) <= spec.tol)
}

export const scoreAnswer = (checks, text) =>
  Object.fromEntries(Object.entries(checks).map(([k, spec]) => [k, checkOne(spec, text)]))
