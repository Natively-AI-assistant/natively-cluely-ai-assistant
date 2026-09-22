// One source of truth for the app version in the renderer.
//
// VITE_APP_VERSION is injected from package.json by vite.config.mts. Two
// surfaces show a version to the user and they must not drift: the launcher's
// "What's New" pill and the About panel's "What's New" heading. Before this
// helper the pill's version was a hardcoded literal inside a translation key,
// so it silently went stale at every release.
//
// FEATURE version = major.minor ("2.9"), which is what release-note surfaces
// name — a patch release does not get its own What's New. The full version
// stays available for the build footer.

export const APP_VERSION = import.meta.env.VITE_APP_VERSION || 'unknown';

/**
 * "2.9.0" -> "2.9", "2.1.0-beta.1" -> "2.1", "unknown" -> "unknown".
 * Never throws: a version that isn't dotted is returned unchanged.
 */
export function toFeatureVersion(version: string): string {
    const parts = version.split('.');
    return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : version;
}

/** major.minor of the running build, e.g. "2.9". */
export const APP_FEATURE_VERSION = toFeatureVersion(APP_VERSION);
