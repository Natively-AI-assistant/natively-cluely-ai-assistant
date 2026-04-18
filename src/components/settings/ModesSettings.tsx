/**
 * ModesSettings — public stub
 *
 * The implementation lives in the private premium/ submodule.
 * This file re-exports it via the premium loader so that callers
 * in src/ never need to know where the real code lives.
 *
 * In an open-source build (no premium/ folder), the premium loader
 * returns a NullComponent and this panel simply renders nothing.
 */
export { ModesSettings as default } from '../../premium';
