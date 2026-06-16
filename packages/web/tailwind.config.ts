import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Notebook palette — friendly, soft, content-first.
        canvas: "#f6f7f9", // app background
        card: "#ffffff",
        "card-2": "#fafbfc",
        ink: {
          DEFAULT: "#15224a",
          2: "#3a3f47",
        },
        muted: {
          DEFAULT: "#6e7682",
          2: "#aab1bd",
        },
        rule: {
          DEFAULT: "#e6e8ed",
          2: "#d0d4dc",
        },
        cobalt: {
          DEFAULT: "#2f6bff",
          50: "#eaf0ff",
          100: "#d6e2ff",
          200: "#adc6ff",
          300: "#7aa3ff",
          400: "#4d84ff",
          500: "#2f6bff",
          600: "#1f54e6",
          700: "#1741b8",
          800: "#102e85",
          900: "#0a1c54",
        },
        // Semantic accents — color-coded to functions.
        teal: {
          DEFAULT: "#16c2b3",
          soft: "#dff7f4",
          ink: "#0e7a72",
        },
        amber: {
          DEFAULT: "#f59e0b",
          soft: "#fbf1de",
          ink: "#92600a",
        },
        coral: {
          DEFAULT: "#e6492d",
          soft: "#fde7e2",
          ink: "#b5321b",
        },
        green: {
          DEFAULT: "#15a06b",
          soft: "#e3f5ec",
          ink: "#0e7a50",
        },
        // Back-compat aliases for existing className usages.
        leaf: {
          DEFAULT: "#15a06b",
          soft: "#e3f5ec",
        },
        rose: {
          DEFAULT: "#e6492d",
          soft: "#fde7e2",
          ink: "#b5321b",
        },
      },
      fontFamily: {
        sans: ['"Inter"', "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ['"Lora"', "ui-serif", "Georgia", "serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "Menlo", "monospace"],
      },
      borderRadius: {
        nb: "12px",
        "nb-sm": "8px",
      },
      boxShadow: {
        nb: "0 1px 2px rgba(15, 23, 42, 0.04), 0 4px 12px -4px rgba(15, 23, 42, 0.06)",
        "nb-hover": "0 2px 4px rgba(15, 23, 42, 0.06), 0 12px 32px -8px rgba(15, 23, 42, 0.12)",
        "nb-pop": "0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 28px -8px rgba(15, 23, 42, 0.18)",
        "nb-cobalt": "0 1px 2px rgba(47, 107, 255, 0.3), 0 4px 12px -2px rgba(47, 107, 255, 0.35)",
        glass: "0 4px 16px -8px rgba(30, 60, 110, 0.22)",
        "glass-lg": "0 8px 28px -10px rgba(30, 60, 110, 0.28)",
      },
      animation: {
        "fade-in": "fade-in 240ms ease-out both",
        "fade-up": "fade-up 360ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "slide-in-right": "slide-in-right 320ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "expand-card": "expand-card 280ms cubic-bezier(0.22, 1, 0.36, 1) both",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in-right": {
          "0%": { opacity: "0", transform: "translateX(20px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        "expand-card": {
          "0%": { opacity: "0", maxHeight: "0", paddingTop: "0", paddingBottom: "0" },
          "100%": { opacity: "1", maxHeight: "4000px" },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
