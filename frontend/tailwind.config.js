/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#F92232',
          50:  '#FFF1F2',
          100: '#FFE0E2',
          200: '#FFC5C9',
          300: '#FF9AA1',
          400: '#FF5F6A',
          500: '#F92232',
          600: '#E01020',
          700: '#BC0C1B',
          800: '#9B0E1A',
          900: '#80121A',
        },
        neutral: {
          text:   '#404040',
          border: '#EBEBEB',
          muted:  '#717171',
          subtle: '#F5F5F5',
        },
      },
    },
  },
  plugins: [],
};

