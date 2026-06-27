import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./contexts/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        market: {
          50:  "#fffbeb",
          100: "#fef3c7",
          200: "#fde68a",
          300: "#fcd34d",
          400: "#fbbf24",
          500: "#f59e0b",
          600: "#d97706",
          700: "#b45309",
          800: "#92400e",
          900: "#78350f",
        },
        ink: {
          900: "#0c0a06",
          800: "#151208",
          700: "#1f1a0d",
          600: "#2a2212",
          500: "#3d3218",
        },
      },
      fontFamily: {
        display: ["'Playfair Display'", "serif"],
        body:    ["'DM Sans'", "sans-serif"],
        mono:    ["'JetBrains Mono'", "monospace"],
      },
      animation: {
        "fade-in":   "fadeIn 0.5s ease-out",
        "slide-up":  "slideUp 0.4s ease-out",
        "slide-in":  "slideIn 0.3s ease-out",
        "shimmer":   "shimmer 1.5s infinite",
        "scale-in":  "scaleIn 0.25s ease-out both",
        "pulse-soft":"pulseSoft 2s cubic-bezier(0.4,0,0.6,1) infinite",
      },
      keyframes: {
        fadeIn:    { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        slideUp:   { "0%": { opacity: "0", transform: "translateY(20px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        slideIn:   { "0%": { opacity: "0", transform: "translateX(-10px)" }, "100%": { opacity: "1", transform: "translateX(0)" } },
        shimmer:   { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
        scaleIn:   { "0%": { opacity: "0", transform: "scale(0.6)" }, "100%": { opacity: "1", transform: "scale(1)" } },
        pulseSoft: { "0%, 100%": { opacity: "1" }, "50%": { opacity: "0.55" } },
      },
    },
  },
  plugins: [],
};

export default config;
