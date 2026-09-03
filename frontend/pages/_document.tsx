import Document, { Html, Head, Main, NextScript, DocumentContext, DocumentInitialProps } from "next/document";
import SanitizedHtml from "@/components/SanitizedHtml";

// Inline script applied before hydration to prevent flash of wrong theme.
// Must remain synchronous and inline — do NOT move to next/script.
const themeScript = `
(function(){
  try {
    var stored = localStorage.getItem('smp_theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var prefersHighContrast = window.matchMedia('(prefers-contrast: more)').matches;
    
    var theme = 'light';
    if (stored === 'light' || stored === 'dark' || stored === 'high-contrast') {
      theme = stored;
    } else if (prefersHighContrast) {
      theme = 'high-contrast';
    } else if (prefersDark) {
      theme = 'dark';
    }
    
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else if (theme === 'high-contrast') {
      document.documentElement.classList.add('high-contrast', 'dark');
    }
  } catch(e){}
})();
`;

type MarketPayDocumentProps = DocumentInitialProps & {
  nonce?: string;
};

export default function MarketPayDocument({ nonce }: MarketPayDocumentProps) {
  return (
    <Html lang="en">
      <Head nonce={nonce}>
        <SanitizedHtml as="script" nonce={nonce} html={themeScript} />
      </Head>
      <body>
        <Main />
        <NextScript nonce={nonce} />
      </body>
    </Html>
  );
}

MarketPayDocument.getInitialProps = async (ctx: DocumentContext): Promise<MarketPayDocumentProps> => {
  const initialProps = await Document.getInitialProps(ctx);
  const nonceHeader = ctx.req?.headers["x-nonce"];
  const nonce = Array.isArray(nonceHeader) ? nonceHeader[0] : nonceHeader;

  return {
    ...initialProps,
    nonce,
  };
};
