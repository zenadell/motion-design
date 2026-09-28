// `import text from './file.md?raw'` — bundled as a string by esbuild (scripts/build.mjs) and vitest.
declare module '*?raw' {
  const text: string;
  export default text;
}
