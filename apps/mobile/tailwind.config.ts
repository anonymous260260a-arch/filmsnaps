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
        void: '#070708',
        surface: '#0E0E11',
        elevated: '#16161A',
        subtle: '#222226',
        primary: '#D4A237',
        'primary-dim': '#B88B2A',
        secondary: '#8B5CF6',
        success: '#4CAF82',
        destructive: '#E05252',
        info: '#5B9CF6',
        'text-primary': '#F4F4F5',
        'text-secondary': '#A1A1AA',
        'text-tertiary': '#52525B',
      },
    },
  },
  plugins: [],
};
