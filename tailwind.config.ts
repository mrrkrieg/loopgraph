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
        ink: "#17202a",
        paper: "#f7f2ea",
        line: "#ded8cd",
        signal: "#ef6f56",
        sage: "#8fb996",
        sky: "#8bb7d8",
        plum: "#a98bc4"
      }
    }
  },
  plugins: []
};

export default config;
