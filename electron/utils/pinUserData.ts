// Pin the packaged app's userData to the historical "Natively" folder, BEFORE
// any module reads app.getPath('userData') at import time.
//
// The on-disk app identity is disguised at build time (productName, sourced from
// scripts/disguise-name.cjs → bundle/executable/helpers on macOS, exe + version
// resource on Windows) so Activity Monitor, proc_pidpath and Task Manager never
// show "Natively". The user profile, however, must stay in the historical
// "Natively" folder — otherwise the first launch of a disguised build would look
// in "~/…/<disguise name>" (e.g. corespeechd) and orphan every existing user's
// settings, transcripts and credentials.
//
// WHY A SEPARATE MODULE (not an inline statement in main.ts): ES imports are
// hoisted and evaluated in source order, and several modules read
// app.getPath('userData') at MODULE SCOPE (CredentialsManager resolves five
// credential paths the instant it is imported). An inline pin in main.ts runs
// only after ALL imports have evaluated — too late for those readers, which
// would resolve against the pre-pin path. On the default case-insensitive
// volumes (APFS / NTFS) that is invisible; on a case-sensitive volume it splits
// the credential files from the rest of the profile. Importing this module
// first guarantees the pin lands before every import-time reader.
//
// Packaged only: a dev instance already resolves to the npm name ("natively"),
// which is the same case-insensitive folder. The NATIVELY_AGENT_USER_DATA
// override is applied later, at main.ts module scope, and must still win in dev.
import { app } from 'electron';
import path from 'path';

if (app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('appData'), 'Natively'));
}
