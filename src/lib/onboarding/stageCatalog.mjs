// Test mirror of stageCatalog.ts. It used to restate every stage by hand and
// drifted from the shipped catalog; tests run with --experimental-strip-types,
// so it now re-exports the real one.
export * from './stageCatalog.ts';
