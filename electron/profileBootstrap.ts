// This module is imported before the rest of the Electron main graph. It must
// select the durable Linux profile before statically imported services resolve
// app.getPath('userData') or open their stores.

import { app } from 'electron';
import {
  migrateDurableProfile,
  resolveDurableProfile,
} from './utils/durableProfile.mjs';

try {
  const plan = resolveDurableProfile({
    platform: process.platform,
    packaged: Boolean(app.isPackaged),
  });

  if (plan) {
    const migration = migrateDurableProfile({
      durablePath: plan.durablePath,
      legacyPaths: plan.legacyPaths as string[],
    });
    app.setPath('userData', plan.durablePath);
    console.log('[ProfileBootstrap] Linux packaged profile:', plan.durablePath);
    if (migration.copied.length) {
      console.log(`[ProfileBootstrap] Migrated ${migration.copied.length} durable profile entries from the legacy profile.`);
    }
  }
} catch (error) {
  // A profile migration must never prevent the app from opening. Electron will
  // keep its normal userData path if the optional migration cannot be completed.
  const detail = error instanceof Error ? error.message : String(error);
  console.warn('[ProfileBootstrap] Durable profile migration skipped:', detail);
}
