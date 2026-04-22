/**
 * Framer-motion mock for jsdom testing.
 *
 * Stubs all motion components to render as plain DOM elements,
 * and AnimatePresence to render children directly.
 */

import React from 'react'
import { vi } from 'vitest'

// HTML elements that framer-motion wraps
const elements = [
  'div', 'span', 'p', 'a', 'button', 'input', 'textarea', 'select', 'option',
  'form', 'label', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'section', 'article', 'main', 'nav', 'header', 'footer', 'aside', 'img',
  'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon',
  'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'video', 'audio', 'canvas',
]

const motion: Record<string, React.FC<any>> = {}
for (const tag of elements) {
  motion[tag] = ({ children, ...props }: any) => {
    const {
      whileHover, whileTap, whileFocus, whileDrag, whileInView,
      animate, initial, exit, transition, variants, layout, layoutId,
      drag, dragConstraints, dragElastic, dragMomentum,
      style, className, onClick, onMouseEnter, onMouseLeave,
      onAnimationStart, onAnimationComplete, ...domProps
    } = props
    return React.createElement(tag, { ...domProps, style, className, onClick, onMouseEnter, onMouseLeave }, children)
  }
}

export { motion }

export const AnimatePresence: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  React.createElement(React.Fragment, null, children)

export const LayoutGroup: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  React.createElement(React.Fragment, null, children)

export const useAnimation = () => ({
  start: vi.fn(),
  stop: vi.fn(),
  set: vi.fn(),
})

export const useMotionValue = (initial: any) => ({
  get: () => initial,
  set: vi.fn(),
  onChange: vi.fn(),
  destroy: vi.fn(),
})

export const useSpring = useMotionValue
export const useTransform = () => ({ get: () => 0, set: vi.fn() })
export const useInView = () => true
export const useScroll = () => ({ scrollY: useMotionValue(0), scrollX: useMotionValue(0) })
