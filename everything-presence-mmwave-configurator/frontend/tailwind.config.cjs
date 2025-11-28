module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        midnight: {
          900: '#0f172a',
          800: '#111827',
          700: '#1f2937',
        },
        aqua: {
          500: '#34d399',
          600: '#10b981',
          700: '#0ea271',
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'Inter', 'system-ui', 'sans-serif'],
        body: ['"Inter Tight"', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
