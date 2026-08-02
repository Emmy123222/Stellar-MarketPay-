#!/usr/bin/env node
/**
 * scripts/audit-contrast.mjs
 * 
 * Manual contrast audit script to verify WCAG 2.1 AA compliance
 * for all theme color combinations.
 * 
 * Usage: node scripts/audit-contrast.mjs
 */

/**
 * Calculate relative luminance of an RGB color
 * https://www.w3.org/WAI/GL/wiki/Relative_luminance
 */
function getLuminance(r, g, b) {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const val = c / 255;
    return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Calculate contrast ratio between two colors
 * https://www.w3.org/WAI/GL/wiki/Contrast_ratio
 */
function getContrastRatio(color1, color2) {
  const lum1 = getLuminance(...color1);
  const lum2 = getLuminance(...color2);
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  return (brightest + 0.05) / (darkest + 0.05);
}

/**
 * Convert hex color to RGB array
 */
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [
        parseInt(result[1], 16),
        parseInt(result[2], 16),
        parseInt(result[3], 16),
      ]
    : null;
}

/**
 * Check if contrast ratio meets WCAG standards
 */
function checkContrast(ratio, standard = "AA") {
  const thresholds = {
    AA: { normal: 4.5, large: 3.0 },
    AAA: { normal: 7.0, large: 4.5 },
  };
  return {
    normalText: ratio >= thresholds[standard].normal,
    largeText: ratio >= thresholds[standard].large,
    ratio: ratio.toFixed(2),
  };
}

// Theme definitions
const themes = {
  light: {
    bg: "#fafaf8",
    surface: "#ffffff",
    text: "#1c1917",
    textMuted: "#57534e",
    textSubtle: "#78716c",
    gold: "#b45309",
    goldLight: "#b45309",  // Same as gold for consistency
  },
  dark: {
    bg: "#0c0a06",
    surface: "#151208",
    text: "#fef3c7",
    textMuted: "#d4b896",
    textSubtle: "#9d8760",  // Improved for better contrast
    gold: "#fbbf24",
    goldLight: "#fcd34d",
  },
  highContrast: {
    bg: "#000000",
    surface: "#000000",
    text: "#ffffff",
    textMuted: "#e0e0e0",
    textSubtle: "#b0b0b0",
    gold: "#ffdd44",
    goldLight: "#ffee88",
  },
};

console.log("🎨 WCAG 2.1 Color Contrast Audit\n");
console.log("═".repeat(70));

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

for (const [themeName, colors] of Object.entries(themes)) {
  console.log(`\n📋 ${themeName.toUpperCase()} THEME`);
  console.log("─".repeat(70));

  const tests = [
    { fg: "text", bg: "bg", type: "Normal text on background" },
    { fg: "text", bg: "surface", type: "Normal text on surface" },
    { fg: "textMuted", bg: "bg", type: "Muted text on background" },
    { fg: "textMuted", bg: "surface", type: "Muted text on surface" },
    { fg: "textSubtle", bg: "bg", type: "Subtle text on background" },
    { fg: "textSubtle", bg: "surface", type: "Subtle text on surface" },
    { fg: "gold", bg: "bg", type: "Gold (accent) on background" },
    { fg: "gold", bg: "surface", type: "Gold (accent) on surface" },
    { fg: "goldLight", bg: "bg", type: "Gold light on background" },
  ];

  for (const test of tests) {
    const fgColor = hexToRgb(colors[test.fg]);
    const bgColor = hexToRgb(colors[test.bg]);

    if (!fgColor || !bgColor) {
      console.log(`⚠️  Invalid color format for ${test.type}`);
      continue;
    }

    const ratio = getContrastRatio(fgColor, bgColor);
    const check = checkContrast(ratio);

    totalTests++;

    const status = check.normalText ? "✅" : "❌";
    const normalStatus = check.normalText ? "PASS" : "FAIL";
    const largeStatus = check.largeText ? "PASS" : "FAIL";

    if (check.normalText) {
      passedTests++;
    } else {
      failedTests++;
    }

    console.log(
      `${status} ${test.type.padEnd(35)} ${check.ratio}:1 (Normal: ${normalStatus}, Large: ${largeStatus})`
    );
  }
}

console.log("\n" + "═".repeat(70));
console.log(`\n📊 SUMMARY`);
console.log("─".repeat(70));
console.log(`Total Tests:  ${totalTests}`);
console.log(`Passed:       ${passedTests} ✅`);
console.log(`Failed:       ${failedTests} ❌`);
console.log(
  `Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`
);

console.log("\n📚 WCAG 2.1 Level AA Requirements:");
console.log("   • Normal text (< 18pt): 4.5:1 minimum");
console.log("   • Large text (≥ 18pt):  3.0:1 minimum");
console.log("   • UI components:        3.0:1 minimum");

if (failedTests > 0) {
  console.log("\n⚠️  CONTRAST ISSUES DETECTED");
  console.log("Please review the failed tests above and adjust colors accordingly.");
  process.exit(1);
} else {
  console.log("\n✨ ALL CONTRAST TESTS PASSED!");
  console.log("Your color palette meets WCAG 2.1 Level AA standards.");
  process.exit(0);
}
