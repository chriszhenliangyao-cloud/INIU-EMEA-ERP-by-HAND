import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        eu: { 50: '#faf5ff', 100: '#f3e8ff', 500: '#a855f7', 600: '#9333ea' },
        na: { 50: '#eff6ff', 100: '#dbeafe', 500: '#3b82f6', 600: '#2563eb' },
      },
    },
  },
  plugins: [],
}
export default config
