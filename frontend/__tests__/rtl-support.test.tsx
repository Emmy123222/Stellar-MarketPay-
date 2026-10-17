import "./setup/snapshotMocks";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { sampleJob } from "./helpers/fixtures";

import AppFooter from "@/components/AppFooter";
import JobCard from "@/components/JobCard";
import Navbar from "@/components/Navbar";
import { PSEUDO_RTL_LOCALE, getDirection, isRtl } from "@/lib/direction";

const noop = () => {};

describe("getDirection", () => {
  it.each(["ar", "ar-EG", "he", "fa", "ur", "ps", "yi", "ckb", "pa-Arab", "ar_SA"])(
    "treats %s as right-to-left",
    (locale) => {
      expect(getDirection(locale)).toBe("rtl");
      expect(isRtl(locale)).toBe(true);
    },
  );

  it.each(["en", "es", "fr", "pt", "pt-BR", "de", "zh-Hans", undefined, null, ""])(
    "treats %s as left-to-right",
    (locale) => {
      expect(getDirection(locale)).toBe("ltr");
    },
  );

  it("exposes a pseudo-RTL locale that keeps English copy but mirrors layout", () => {
    expect(PSEUDO_RTL_LOCALE).toBe("en-XB");
    expect(getDirection(PSEUDO_RTL_LOCALE)).toBe("rtl");
    expect(getDirection("en-xb")).toBe("rtl");
  });
});

describe("document direction wiring", () => {
  const root = join(__dirname, "..");

  it("sets dir on <Html> from the request locale in _document", () => {
    const source = readFileSync(join(root, "pages/_document.tsx"), "utf8");
    expect(source).toMatch(/getDirection\(/);
    expect(source).toMatch(/<Html\s+lang=\{lang\}\s+dir=\{getDirection\(lang\)\}/);
    expect(source).toMatch(/locale:\s*ctx\.locale/);
  });

  it("keeps documentElement dir/lang in sync on client-side language changes in _app", () => {
    const source = readFileSync(join(root, "pages/_app.tsx"), "utf8");
    expect(source).toMatch(/documentElement\.dir\s*=\s*getDirection\(/);
    expect(source).toMatch(/documentElement\.lang\s*=/);
  });
});

/**
 * Physical-direction utilities do not flip under dir="rtl"; their logical
 * counterparts (ms-/pe-/start-/text-start/rounded-s…) do. These shared
 * components must therefore render only logical ones.
 */
const PHYSICAL_UTILITY =
  /^(?:[a-z0-9-]+:)*!?-?(?:m[lr]|p[lr]|left|right|scroll-m[lr]|scroll-p[lr])-[\w./[\]-]+$|^(?:[a-z0-9-]+:)*(?:text-(?:left|right)|float-(?:left|right)|border-[lr](?:-[\w./[\]-]+)?|rounded-(?:l|r|tl|tr|bl|br)(?:-[\w./[\]-]+)?)$/;

// left-1/2 / right-1/2 pair with -translate-x-1/2 for centring and are mirror-safe.
const CENTRING = /^-?(?:left|right)-1\/2$/;

function physicalClasses(container: HTMLElement): string[] {
  const offenders = new Set<string>();
  container.querySelectorAll<HTMLElement>("[class]").forEach((element) => {
    const raw = element.getAttribute("class") ?? "";
    for (const token of raw.split(/\s+/).filter(Boolean)) {
      const base = token.slice(token.lastIndexOf(":") + 1);
      if (PHYSICAL_UTILITY.test(token) && !CENTRING.test(base)) offenders.add(token);
    }
  });
  return [...offenders];
}

function renderRtl(ui: React.ReactElement) {
  return render(<div dir="rtl">{ui}</div>);
}

describe("shared components render mirrored under an RTL locale", () => {
  it("AppFooter uses no physical-direction utilities and is centred", () => {
    const { container } = renderRtl(<AppFooter onOpenShortcuts={noop} />);
    expect(container.firstElementChild).toHaveAttribute("dir", "rtl");
    expect(physicalClasses(container)).toEqual([]);
    expect(container.querySelector("footer")).toHaveClass("text-center");
  });

  it("JobCard uses no physical-direction utilities and aligns amounts to the end", () => {
    const { container } = renderRtl(<JobCard job={sampleJob} />);
    expect(physicalClasses(container)).toEqual([]);
    expect(container.querySelector(".text-end")).not.toBeNull();
    expect(container.querySelector(".text-right")).toBeNull();
  });

  it("Navbar uses no physical-direction utilities and logical dropdown anchors", () => {
    const { container } = renderRtl(
      <Navbar publicKey={null} onConnect={noop} onDisconnect={noop} />,
    );
    expect(physicalClasses(container)).toEqual([]);
    expect(container.querySelector(".text-right")).toBeNull();
  });

  it("the offender detector flags physical utilities (guards against a vacuous pass)", () => {
    const host = document.createElement("div");
    host.innerHTML =
      '<span class="ml-2 md:pr-4 text-left -left-1 rounded-l-lg border-r"></span><span class="ms-2 md:pe-4 text-start start-0 rounded-s-lg border-e left-1/2"></span>';
    expect(physicalClasses(host).sort()).toEqual(
      ["-left-1", "border-r", "md:pr-4", "ml-2", "rounded-l-lg", "text-left"].sort(),
    );
  });
});
