module.exports = {
  theme: {
    extend: {
      colors: {
        background: "var(--tg-background)",
        surface: "var(--tg-surface)",
        "surface-muted": "var(--tg-surface-muted)",
        border: "var(--tg-border)",
        "border-strong": "var(--tg-border-strong)",
        foreground: "var(--tg-foreground)",
        muted: "var(--tg-muted)",
        primary: {
          DEFAULT: "var(--tg-primary)",
          hover: "var(--tg-primary-hover)",
          light: "var(--tg-primary-light)",
          foreground: "var(--tg-primary-foreground)"
        },
        brand: {
          DEFAULT: "var(--tg-brand-500)",
          50: "var(--tg-brand-50)",
          100: "var(--tg-brand-100)",
          200: "var(--tg-brand-200)",
          300: "var(--tg-brand-300)",
          400: "var(--tg-brand-400)",
          500: "var(--tg-brand-500)",
          600: "var(--tg-brand-600)",
          700: "var(--tg-brand-700)"
        },
        accent: {
          DEFAULT: "var(--tg-accent-500)",
          50: "var(--tg-accent-50)",
          100: "var(--tg-accent-100)",
          500: "var(--tg-accent-500)"
        },
        neutral: {
          DEFAULT: "var(--tg-neutral-900)",
          100: "var(--tg-neutral-100)",
          700: "var(--tg-neutral-700)",
          900: "var(--tg-neutral-900)"
        },
        success: {
          DEFAULT: "var(--tg-success)",
          50: "var(--tg-success-50)",
          200: "var(--tg-success-200)",
          700: "var(--tg-success-700)"
        },
        warning: {
          DEFAULT: "var(--tg-warning)",
          50: "var(--tg-warning-50)",
          100: "var(--tg-warning-100)",
          200: "var(--tg-warning-200)",
          700: "var(--tg-warning-700)"
        },
        danger: {
          DEFAULT: "var(--tg-danger)",
          50: "var(--tg-danger-50)",
          200: "var(--tg-danger-200)",
          700: "var(--tg-danger-700)"
        },
        code: "var(--tg-code-bg)",
        "code-text": "var(--tg-code-text)"
      },
      boxShadow: {
        soft: "var(--tg-elevation-0)",
        panel: "var(--tg-elevation-1)",
        overlay: "var(--tg-elevation-2)"
      },
      letterSpacing: {
        normal: "var(--tg-letter-spacing)"
      },
      borderRadius: {
        sm: "var(--tg-radius-sm)",
        md: "var(--tg-radius-md)",
        lg: "var(--tg-radius-lg)",
        xl: "var(--tg-radius-panel)",
        "2xl": "var(--tg-radius-panel)",
        full: "var(--tg-radius-full)"
      },
      fontSize: {
        display: ["var(--tg-text-display-size)", { lineHeight: "var(--tg-text-display-line)", fontWeight: "var(--tg-text-display-weight)", letterSpacing: "var(--tg-letter-spacing)" }],
        title: ["var(--tg-text-title-size)", { lineHeight: "var(--tg-text-title-line)", fontWeight: "var(--tg-text-title-weight)", letterSpacing: "var(--tg-letter-spacing)" }],
        body: ["var(--tg-text-body-size)", { lineHeight: "var(--tg-text-body-line)", letterSpacing: "var(--tg-letter-spacing)" }],
        label: ["var(--tg-text-label-size)", { lineHeight: "var(--tg-text-label-line)", letterSpacing: "var(--tg-letter-spacing)" }],
        caption: ["var(--tg-text-caption-size)", { lineHeight: "var(--tg-text-caption-line)", letterSpacing: "var(--tg-letter-spacing)" }]
      },
      maxWidth: {
        content: "var(--tg-content-max)"
      },
      minHeight: {
        detail: "var(--tg-detail-min-h)"
      },
      fontFamily: {
        sans: ["var(--tg-font-sans)"]
      }
    }
  }
};
