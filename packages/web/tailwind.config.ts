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
          DEFAULT: "#1f2328",
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
          DEFAULT: "#4f6df0",
          50: "#eaeefe",
          100: "#d5dcfc",
          200: "#aebbfa",
          300: "#8094f6",
          400: "#5b76f2",
          500: "#4f6df0",
          600: "#3a55d8",
          700: "#2b40a8",
          800: "#1e2d76",
          900: "#121a45",
        },
        // Status accents
        leaf: {
          DEFAULT: "#2f9968",
          soft: "#e3f5ec",
        },
        amber: {
          DEFAULT: "#c98a26",
          soft: "#fbf1de",
        },
        rose: {
          DEFAULT: "#d4546b",
          soft: "#fde9ec",
          ink: "#94293c",
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
        "nb-cobalt": "0 1px 2px rgba(79, 109, 240, 0.3), 0 4px 12px -2px rgba(79, 109, 240, 0.35)",
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
