import { sanitizeInlineScript, sanitizeRichHtml } from "@/lib/sanitize";

type SanitizedHtmlProps = {
  html: string;
  as?: "span" | "div" | "script";
  className?: string;
  nonce?: string;
};

export default function SanitizedHtml({ html, as = "span", className, nonce }: SanitizedHtmlProps) {
  const sanitizedHtml = as === "script" ? sanitizeInlineScript(html) : sanitizeRichHtml(html);
  const Element = as;

  return <Element className={className} nonce={nonce} dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />;
}