/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        primary: '#3559d7',
        secondary: '#1f9d72',
        accent: '#d99b32',
        background: '#f5f6f8',
        surface: '#ffffff',
        canvas: '#f5f6f8',
        ink: {
          50: '#f5f6f7',
          100: '#e7e9ed',
          200: '#d5d9df',
          300: '#b5bcc6',
          400: '#8993a1',
          500: '#667180',
          600: '#4c5664',
          700: '#39414d',
          800: '#242b35',
          900: '#171c24',
          950: '#0b0f15',
        },
        brand: {
          50: '#eef2ff',
          100: '#dfe6ff',
          500: '#4968df',
          600: '#3559d7',
          700: '#2947b4',
        },
      },
      fontFamily: {
        sans: ['Microsoft YaHei', 'Noto Sans SC', 'Segoe UI', 'sans-serif'],
        display: ['Microsoft YaHei', 'Noto Sans SC', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
