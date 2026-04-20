/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#f0f4ff',
          100: '#dce6ff',
          500: '#2a52cc',
          600: '#1e3db5',
          700: '#162e99',
          900: '#0a1a5c',
        },
        steel: {
          50:  '#f4f5f6',
          100: '#e4e6e9',
          200: '#c8cdd4',
          400: '#8c95a3',
          600: '#4a5568',
          800: '#1f2937',
          900: '#111827',
        }
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
