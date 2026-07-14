/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["../index.html", "../app.js"],
  // Class di sini dibangun secara dinamis lewat template literal di app.js
  // (mis. `reader-theme-${t}`), jadi nama lengkapnya gak pernah muncul
  // sebagai teks literal di file manapun — Tailwind gak bisa mendeteksinya
  // lewat content-scanning biasa, makanya perlu didaftarkan manual di sini
  // supaya gak ikut ke-purge dari CSS output.
  safelist: [
    'reader-theme-light',
    'reader-theme-sepia',
    'reader-theme-dark',
    'reader-font-sans',
    'reader-font-serif',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'sans-serif'],
        display: ['"Baloo 2"', 'sans-serif'],
      },
      colors: {
        paper: '#FBF6EC',
        ink: '#1A1A2E',
        coral: { DEFAULT: '#FF5A3C', dark: '#E8431F', light: '#FFE8E2' },
        cobalt: { DEFAULT: '#2D5FFF', dark: '#1A46E0', light: '#E3ECFF' },
        sunny: { DEFAULT: '#FFC93C', dark: '#E0A800', light: '#FFF6D9' },
        mint: { DEFAULT: '#1FAE7A', dark: '#158A61', light: '#E1F7EC' },
        violet: { DEFAULT: '#8B5CF6', dark: '#7139E0', light: '#EDE6FF' },
        pink: { DEFAULT: '#FF4FA3', dark: '#E22F86', light: '#FFE3F1' },
      },
      boxShadow: {
        pop: '4px 4px 0 #1A1A2E',
        'pop-sm': '2.5px 2.5px 0 #1A1A2E',
        'pop-lg': '6px 6px 0 #1A1A2E',
        'pop-coral': '4px 4px 0 #E8431F',
      },
      keyframes: {
        toastIn: {
          '0%': { opacity: '0', transform: 'translateY(8px) scale(0.96)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        popIn: {
          '0%': { opacity: '0', transform: 'scale(0.94) rotate(-1deg)' },
          '100%': { opacity: '1', transform: 'scale(1) rotate(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-400px 0' },
          '100%': { backgroundPosition: '400px 0' },
        },
        wiggle: {
          '0%, 100%': { transform: 'rotate(-1.5deg)' },
          '50%': { transform: 'rotate(1.5deg)' },
        },
      },
      animation: {
        toastIn: 'toastIn 0.25s cubic-bezier(0.4,0,0.2,1)',
        popIn: 'popIn 0.2s cubic-bezier(0.34,1.56,0.64,1)',
        shimmer: 'shimmer 1.6s infinite linear',
        wiggle: 'wiggle 0.4s ease-in-out',
      },
    },
  },
  plugins: [],
}
