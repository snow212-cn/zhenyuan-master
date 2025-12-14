/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        game: {
          dark: 'var(--bg-main)',
          panel: 'var(--bg-panel)',
          accent: 'var(--col-accent)',
          success: 'var(--col-success)',
          warning: 'var(--col-warning)',
          danger: 'var(--col-danger)',
          text: 'var(--col-text-main)',
          muted: 'var(--col-text-muted)',
          highlight: 'var(--col-highlight)',
          border: 'var(--col-border)'
        }
      }
    },
  },
  plugins: [],
}