import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#111111",
        paper: "#f6f5f2",
        line: "#dedbd2",
        signal: "#f97316",
        success: "#16a34a",
        review: "#2563eb",
        risk: "#dc2626",
        improve: "#7c3aed",
        amber: "#d97706",
        teal: "#0f766e",
        sky: "#2563eb",
        plum: "#7c3aed"
      }
    }
  },
  plugins: []
};

export default config;
