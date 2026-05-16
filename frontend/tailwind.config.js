/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#F7F6F2',
        ink: {
          DEFAULT: '#0E0E10',
          secondary: '#4A4A52',
          tertiary: '#8A8A93',
        },
        accent: {
          DEFAULT: '#B8956A',
          soft: '#E8DCC4',
          deep: '#8A6F4D',
        },
        border: {
          subtle: '#ECEAE3',
          strong: '#D8D5CC',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
