// src/lib/funnel/funnelPow.mjs
//
// The install-registration puzzle: the part the app and the server must agree on.
//
// THIS FILE HAS A TWIN: natively-api/lib/funnelPow.js. Everything below this
// header is the same text in both, and funnelCatalogParity.test.mjs compares
// them. The app solves the puzzle and the server checks it; if they disagree
// about what is hashed or how zero bits are counted, no install can register.
//
// WHAT THE PUZZLE IS. The server hands out a signed challenge. The app finds a
// `solution` (a decimal counter) such that
//
//     sha256( challenge + ':' + solution )
//
// begins with at least `difficulty` zero BITS. Finding one takes about
// 2^difficulty hashes; checking one takes one hash. It costs a real install a
// second or so of background work, once, and costs someone minting made-up
// installs that much for every one of them.

/** What gets hashed. */
export function powInput(challenge, solution) {
  return `${challenge}:${solution}`
}

/** How many zero bits a digest (a byte array) starts with. */
export function leadingZeroBits(bytes) {
  let bits = 0
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]
    if (b === 0) { bits += 8; continue }
    // Math.clz32 counts over 32 bits; a byte occupies the low 8.
    return bits + (Math.clz32(b) - 24)
  }
  return bits
}

/** A solution is a plain decimal counter, nothing else. */
export const POW_SOLUTION = /^(0|[1-9][0-9]{0,15})$/

// The range a difficulty may take. Below the floor it is no puzzle; above the
// ceiling a slow laptop would work for hours, so the app refuses to start and
// the server never asks.
export const POW_MIN_BITS = 8
export const POW_MAX_BITS = 30
