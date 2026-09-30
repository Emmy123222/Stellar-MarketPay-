import createDOMPurify from "dompurify";

const window = typeof globalThis.window === "undefined"
  ? new (eval("require")("jsdom") as typeof import("jsdom")).JSDOM("").window
  : globalThis.window;
const DOMPurify = createDOMPurify(window);

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
