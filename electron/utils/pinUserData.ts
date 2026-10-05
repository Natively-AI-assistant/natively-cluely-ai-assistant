// Pin the packaged app's userData to the disguise-named profile dir, BEFORE
// any module reads app.getPath('userData') at import time. First launch after
// the rename migrates the historical "Natively" folder (atomic rename —
// cannot half-complete); every later launch is a no-op.
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
// override is applied later, at main.ts module scope (dev only), and must
// still win in dev.
//
// Migration safety contract lives in ./migrateUserData.ts — read it before
// touching this file. Short version: atomic rename, never throws (aborts to
// the legacy dir = today's pinned behavior), defers when an old-version
// process is observed, never deletes anything.
import { app } from 'electron';
import fs from 'node:fs';
import path from 'path';
import { runProfileMigration } from './migrateUserData';

if (app.isPackaged) {
  const { dir } = runProfileMigration({
    platform: process.platform,
    isPackaged: true,
    appDataDir: app.getPath('appData'),
    join: path.join,
    fs: {
      existsSync: (p) => fs.existsSync(p),
      readdirSync: (p) => fs.readdirSync(p).map(String),
      renameSync: (o, n) => fs.renameSync(o, n),
      rmdirSync: (p) => fs.rmdirSync(p),
      writeFileSync: (p, d) => fs.writeFileSync(p, d),
    },
  });
  if (dir) {
    app.setPath('userData', dir);
  }
}
