import { Html, Head, Main, NextScript } from "next/document";

// Inline script applied before hydration to prevent flash of wrong theme.
// Must remain synchronous and inline — do NOT move to next/script.
const themeScript = `
(function(){
  try {
    var stored = localStorage.getItem('smp_theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = stored === 'light' ? 'light' : (stored === 'dark' ? 'dark' : (prefersDark ? 'dark' : 'light'));
    if (theme === 'dark') document.documentElement.classList.add('dark');
  } catch(e){}
})();
`;

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/*
         * Theme detection must run synchronously before paint to avoid FOUC.
         * All other scripts should use <Script strategy="lazyOnload"> in _app.tsx.
         */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
