export const content = ["./src/**/*.{js,jsx,ts,tsx}", "./premium/src/**/*.{js,jsx,ts,tsx}", "./public/index.html"]

module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./premium/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: 'var(--bg-primary)',
          secondary: 'var(--bg-secondary)',
          elevated: 'var(--bg-elevated)',
          input: 'var(--bg-input)',

          /* New Semantic Tokens */
          sidebar: 'var(--bg-sidebar)',
          main: 'var(--bg-main)',
          card: 'var(--bg-card)',
          component: 'var(--bg-component)',
          'toggle-switch': 'var(--bg-toggle-switch)',
          'item-surface': 'var(--bg-item-surface)',
          'item-active': 'var(--bg-item-active)',
        },
        // Never chain a Tailwind /NN opacity modifier onto any accent-*, on-accent, or
        // button-primary-* utility — these are bare var() references and Tailwind cannot
        // parse them to recompute alpha; the utility silently compiles to nothing.
        // Add a named token instead.
        accent: {
          primary: 'var(--accent-primary)',
          secondary: 'var(--accent-muted)',
          hover: 'var(--accent-hover)',
          pressed: 'var(--accent-pressed)',
          strong: 'var(--accent-strong)',
          subtle: 'var(--accent-subtle)',
          muted: 'var(--accent-muted)',
          border: 'var(--accent-border)',
          focus: 'var(--accent-focus)',
        },
        'on-accent': 'var(--on-accent)',
        'on-accent-surface': 'var(--on-accent-surface)',
        // Deliberately blue, immune to the Settings orchid scope — for specific
        // action buttons (Save, Fetch Models, Install, etc.) kept on the original
        // color scheme rather than migrated to Soft Orchid.
        'legacy-action': {
          bg: 'var(--legacy-action-bg)',
          hover: 'var(--legacy-action-hover)',
          fg: 'var(--legacy-action-fg)',
          subtle: 'var(--legacy-action-subtle)',
          'subtle-hover': 'var(--legacy-action-subtle-hover)',
          border: 'var(--legacy-action-border)',
          'disabled-bg': 'var(--legacy-action-disabled-bg)',
          'disabled-border': 'var(--legacy-action-disabled-border)',
          'disabled-text': 'var(--legacy-action-disabled-text)',
        },
        button: {
          primary: {
            bg: 'var(--btn-primary-bg)',
            hover: 'var(--btn-primary-hover)',
            'disabled-bg': 'var(--btn-primary-disabled-bg)',
            'disabled-border': 'var(--btn-primary-disabled-border)',
            'disabled-text': 'var(--btn-primary-disabled-text)',
            'shadow-color': 'var(--btn-primary-shadow-color)',
          }
        },
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          tertiary: 'var(--text-tertiary)',
        },
        border: {
          subtle: 'var(--border-subtle)',
          muted: 'var(--border-muted)',
        },
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"],
        celeb: ["CelebMF", "sans-serif"],
        "celeb-light": ["CelebMFLight", "sans-serif"]
      },
      transitionTimingFunction: {
        "apple-ease": "cubic-bezier(0.25, 1, 0.5, 1)",
        "spring": "cubic-bezier(0.34, 1.56, 0.64, 1)",
        "sculpted": "cubic-bezier(0.22, 1, 0.36, 1)"
      },
      animation: {
        in: "in 0.2s ease-out",
        out: "out 0.2s ease-in",
        pulse: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        shimmer: "shimmer 2s linear infinite",
        "text-gradient-wave": "textGradientWave 2s infinite ease-in-out",
        "fade-in-up": "fadeInUp 0.26s cubic-bezier(0.23, 1, 0.32, 1) forwards",
        "scale-in": "scaleIn 0.2s cubic-bezier(0.34, 1.56, 0.64, 1) forwards"
      },
      keyframes: {
        textGradientWave: {
          "0%": { backgroundPosition: "0% 50%" },
          "100%": { backgroundPosition: "200% 50%" }
        },
        shimmer: {
          "0%": {
            backgroundPosition: "200% 0"
          },
          "100%": {
            backgroundPosition: "-200% 0"
          }
        },
        in: {
          "0%": { transform: "translateY(100%)", opacity: 0 },
          "100%": { transform: "translateY(0)", opacity: 1 }
        },
        out: {
          "0%": { transform: "translateY(0)", opacity: 1 },
          "100%": { transform: "translateY(100%)", opacity: 0 }
        },
        pulse: {
          "0%, 100%": {
            opacity: 1
          },
          "50%": {
            opacity: 0.5
          }
        },
        fadeInUp: {
          "0%": { opacity: 0, transform: "translateY(8px)", filter: "blur(4px)" },
          "100%": { opacity: 1, transform: "translateY(0)", filter: "blur(0px)" }
        },
        scaleIn: {
          "0%": { opacity: 0, transform: "scale(0.95)" },
          "100%": { opacity: 1, transform: "scale(1)" }
        }
      }
    }
  },
  plugins: []
}
