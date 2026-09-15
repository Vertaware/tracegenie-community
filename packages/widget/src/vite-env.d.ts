// Vite CSS module declarations for ?inline imports
declare module "*.css?inline" {
  const css: string;
  export default css;
}

declare module "*.svg?inline" {
  const url: string;
  export default url;
}
