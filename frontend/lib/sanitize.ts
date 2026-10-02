import createDOMPurify from "dompurify";
import { createRequire } from "module";

// `module` is a Node builtin and `jsdom` is server-only. The client bundle
// stubs "module" out (see next.config.mjs) and never evaluates this branch, so
// neither jsdom nor eval() ends up in the browser bundle.
const serverWindow =
  typeof globalThis.window === "undefined"
    ? new (createRequire(import.meta.url)("jsdom") as typeof import("jsdom")).JSDOM("").window
    : globalThis.window;

const DOMPurify = createDOMPurify(serverWindow);

export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
  });
}

export function sanitizeRichHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: ["b", "i", "em", "strong", "a", "p", "br", "ul", "ol", "li", "div", "h1", "h2", "h3", "code", "mark"],
    ALLOWED_ATTR: ["href", "target", "rel", "class"],
  });
}

export function sanitizeInlineScript(script: string): string {
  return DOMPurify.sanitize(script, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
  });
}
