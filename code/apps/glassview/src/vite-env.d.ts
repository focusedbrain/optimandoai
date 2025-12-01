/// <reference types="vite/client" />

// Allow importing .md files as raw text
declare module '*.md?raw' {
  const content: string;
  export default content;
}

declare module '*.md' {
  const content: string;
  export default content;
}
