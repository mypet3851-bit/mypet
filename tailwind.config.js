/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    screens: {
      'xs': '360px', // small phones
      'sm': '640px',
      'md': '768px',
      'lg': '1024px',
      'xl': '1280px',
      '2xl': '1536px',
    },
    extend: {
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(-10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        'spin-slow': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' }
        },
        shine: {
          '0%': { transform: 'translateX(-100%) skewX(-30deg)' },
          '100%': { transform: 'translateX(200%) skewX(-30deg)' }
        },
        slide: {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(-100%)' }
        }
      },
      animation: {
        fadeIn: 'fadeIn 0.2s ease-out',
        'spin-slow': 'spin-slow 3s linear infinite',
        shine: 'shine 1s ease-in-out infinite',
        slide: 'slide 20s linear infinite'
      }
    },
  },
  plugins: [],
}