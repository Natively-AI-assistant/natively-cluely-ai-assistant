import { describe, it, expect } from 'vitest'
import {
    getOverlayAppearance,
    clampOverlayOpacity,
    getDefaultOverlayOpacity,
    OVERLAY_OPACITY_MIN,
    OVERLAY_OPACITY_MAX,
    OVERLAY_OPACITY_DEFAULT_DARK,
    OVERLAY_OPACITY_DEFAULT_LIGHT,
    type OverlayTheme
} from '../../../src/lib/overlayAppearance'

describe('overlayAppearance', () => {
    describe('clampOverlayOpacity', () => {
        it('clamps to minimum (0.35)', () => {
            expect(clampOverlayOpacity(0.1)).toBe(OVERLAY_OPACITY_MIN)
            expect(clampOverlayOpacity(-1)).toBe(OVERLAY_OPACITY_MIN)
            expect(clampOverlayOpacity(0)).toBe(OVERLAY_OPACITY_MIN)
        })

        it('clamps to maximum (1.0)', () => {
            expect(clampOverlayOpacity(1.5)).toBe(OVERLAY_OPACITY_MAX)
            expect(clampOverlayOpacity(10)).toBe(OVERLAY_OPACITY_MAX)
        })

        it('passes through valid values', () => {
            expect(clampOverlayOpacity(0.5)).toBe(0.5)
            expect(clampOverlayOpacity(0.65)).toBe(0.65)
            expect(clampOverlayOpacity(0.35)).toBe(0.35)
            expect(clampOverlayOpacity(1.0)).toBe(1.0)
        })
    })

    describe('getOverlayAppearance', () => {
        it('returns all expected style keys for dark theme', () => {
            const result = getOverlayAppearance(0.8, 'dark')
            expect(result).toHaveProperty('shellStyle')
            expect(result).toHaveProperty('pillStyle')
            expect(result).toHaveProperty('transcriptStyle')
            expect(result).toHaveProperty('subtleStyle')
            expect(result).toHaveProperty('chipStyle')
            expect(result).toHaveProperty('inputStyle')
            expect(result).toHaveProperty('controlStyle')
            expect(result).toHaveProperty('iconStyle')
            expect(result).toHaveProperty('codeBlockStyle')
            expect(result).toHaveProperty('codeHeaderStyle')
            expect(result).toHaveProperty('dividerStyle')
        })

        it('returns all expected style keys for light theme', () => {
            const result = getOverlayAppearance(0.8, 'light')
            expect(result).toHaveProperty('shellStyle')
            expect(result).toHaveProperty('pillStyle')
            expect(result).toHaveProperty('dividerStyle')
        })

        it('dark theme shellStyle has dark background', () => {
            const result = getOverlayAppearance(0.8, 'dark')
            expect(result.shellStyle.backgroundColor).toContain('rgba(24, 26, 32')
        })

        it('light theme shellStyle has light background', () => {
            const result = getOverlayAppearance(0.8, 'light')
            expect(result.shellStyle.backgroundColor).toContain('rgba(214, 228, 247')
        })

        it('transcriptStyle is always transparent', () => {
            const dark = getOverlayAppearance(0.8, 'dark')
            const light = getOverlayAppearance(0.8, 'light')
            expect(dark.transcriptStyle.backgroundColor).toBe('transparent')
            expect(light.transcriptStyle.backgroundColor).toBe('transparent')
        })

        it('minimum opacity produces low-opacity CSS values', () => {
            const result = getOverlayAppearance(OVERLAY_OPACITY_MIN, 'dark')
            // At min opacity, background alpha should be low
            expect(result.shellStyle.backgroundColor).toContain('0.12')
        })

        it('maximum opacity produces full-opacity CSS values', () => {
            const result = getOverlayAppearance(OVERLAY_OPACITY_MAX, 'dark')
            // At max opacity, background alpha should be 1
            expect(result.shellStyle.backgroundColor).toContain(', 1)')
        })

        it('is deterministic for same inputs', () => {
            const a = getOverlayAppearance(0.65, 'dark')
            const b = getOverlayAppearance(0.65, 'dark')
            expect(a.shellStyle.backgroundColor).toBe(b.shellStyle.backgroundColor)
            expect(a.pillStyle.backgroundColor).toBe(b.pillStyle.backgroundColor)
        })

        it('opacity values produce different results', () => {
            const low = getOverlayAppearance(0.35, 'dark')
            const high = getOverlayAppearance(1.0, 'dark')
            expect(low.shellStyle.backgroundColor).not.toBe(high.shellStyle.backgroundColor)
        })

        it('includes backdropFilter styles for dark theme', () => {
            const result = getOverlayAppearance(0.8, 'dark')
            expect(result.shellStyle.backdropFilter).toContain('blur')
            expect(result.shellStyle.backdropFilter).toContain('saturate')
        })

        it('includes WebkitBackdropFilter styles', () => {
            const result = getOverlayAppearance(0.8, 'dark')
            expect(result.shellStyle.WebkitBackdropFilter).toBeDefined()
        })

        it('clamps out-of-range opacity inputs', () => {
            // Should not throw, should clamp internally
            const result = getOverlayAppearance(-10, 'dark')
            expect(result.shellStyle).toBeDefined()
        })
    })

    describe('getDefaultOverlayOpacity', () => {
        it('returns default dark opacity when no theme set', () => {
            // jsdom doesn't have data-theme by default
            const result = getDefaultOverlayOpacity()
            expect(result).toBe(OVERLAY_OPACITY_DEFAULT_DARK)
        })

        it('returns light default when data-theme=light', () => {
            document.documentElement.setAttribute('data-theme', 'light')
            const result = getDefaultOverlayOpacity()
            expect(result).toBe(OVERLAY_OPACITY_DEFAULT_LIGHT)
            document.documentElement.removeAttribute('data-theme')
        })

        it('returns dark default when data-theme=dark', () => {
            document.documentElement.setAttribute('data-theme', 'dark')
            const result = getDefaultOverlayOpacity()
            expect(result).toBe(OVERLAY_OPACITY_DEFAULT_DARK)
            document.documentElement.removeAttribute('data-theme')
        })
    })
})
