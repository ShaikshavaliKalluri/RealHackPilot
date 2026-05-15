/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: {
          950: '#0a0e1a',
          900: '#0f172a',
          800: '#1e293b',
          700: '#334155',
        },
        accent: {
          lime: '#a3e635',
          sky: '#38bdf8',
          violet: '#818cf8',
        },
      },
    },
  },
  plugins: [],
};
