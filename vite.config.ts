import { defineConfig } from 'vite'

// Note: base set to './' so the built files use relative paths.
// This makes the `dist/` folder portable for itch.io and other static hosts
// that serve the game from a subpath.
export default defineConfig({
  base: './',
  server: {
    open: true
  }
})
