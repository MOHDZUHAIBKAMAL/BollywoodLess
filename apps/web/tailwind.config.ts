import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#161819',
        panel: '#202324',
        panelLight: '#2A2E31',
        line: '#34393C',
        accent: '#55B725',
        warning: '#DAC316',
        danger: '#C62121'
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(85, 183, 37, 0.25), 0 18px 60px rgba(0, 0, 0, 0.4)'
      }
    }
  },
  plugins: []
};

export default config;
