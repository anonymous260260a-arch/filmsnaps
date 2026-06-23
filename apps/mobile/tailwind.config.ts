/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        void: '#080808',
        surface: '#0f0f0f',
        elevated: '#191919',
        subtle: '#252525',
        'gold-dim': '#c17a10',
        gold: '#e8a020',
        blue: '#5b9cf6',
        jade: '#4caf82',
        crimson: '#e05252',
        t1: '#f2ede6',
        t2: '#9b9590',
        t3: '#534f4c',
      },
    },
  },
  plugins: [],
};
