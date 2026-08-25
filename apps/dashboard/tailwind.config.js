/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}'
  ],
  theme: {
    extend: {
      colors: {
        background: '#090d16',
        surface: '#111827',
        border: '#1f2937',
        primary: {
          50: '#eef2ff',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca'
        },
        cyan: {
          400: '#22d3ee',
          500: '#06b6d4'
        },
        emerald: {
          400: '#34d399',
          500: '#10b981'
        },
        amber: {
          400: '#fbbf24',
          500: '#f59e0b'
        },
        rose: {
          400: '#fb7185',
          500: '#f43f5e'
        }
      }
    }
  },
  plugins: []
};
