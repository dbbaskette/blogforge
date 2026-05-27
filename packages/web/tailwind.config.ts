import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // "Coffee-and-vermilion" palette — warm, editorial, opinionated.
        ink: "#0E1015", // deepest background
        surface: "#161922", // cards, dialogs
        "surface-2": "#1D2030", // raised surfaces
        rule: "#2A2E3D", // hairline borders
        "rule-2": "#3B404F", // emphasized borders
        cream: "#E8E5DA", // body text
        "cream-2": "#F4F1E7", // emphasized text
        muted: "#9C9885", // metadata
        "muted-2": "#6E6B5E", // very low-emphasis
        vermilion: {
          DEFAULT: "#E04E3F",
          50: "#FDEDEC",
          100: "#FBD9D6",
          200: "#F6B0A8",
          300: "#F08679",
          400: "#E84F3F",
          500: "#E04E3F",
          600: "#B33A2E",
          700: "#822A22",
          800: "#561B16",
          900: "#2C0F0C",
        },
        gold: {
          DEFAULT: "#F4A33C",
          400: "#F4A33C",
          500: "#D9892A",
          600: "#A66920",
        },
        teal: {
          DEFAULT: "#7AA8B0",
          400: "#7AA8B0",
        },
      },
      fontFamily: {
        display: ['"Fraunces"', "ui-serif", "Georgia", "serif"],
        body: ['"Newsreader"', "ui-serif", "Georgia", "serif"],
        ui: ['"Inter Tight"', "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "Menlo", "monospace"],
      },
      fontVariationSettings: {
        "display-soft": '"SOFT" 80, "WONK" 1',
        "display-tight": '"SOFT" 20, "WONK" 0',
      },
      letterSpacing: {
        "tight-2": "-0.04em",
        "wide-3": "0.18em",
      },
      animation: {
        "fade-up": "fade-up 600ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "slide-in": "slide-in 700ms cubic-bezier(0.22, 1, 0.36, 1) both",
        ink: "ink 1.6s ease-out forwards",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in": {
          "0%": { opacity: "0", transform: "translateX(-16px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        ink: {
          "0%": { width: "0%" },
          "100%": { width: "100%" },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
