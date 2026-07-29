import fs from 'fs';
import path from 'path';

const LOCALES_DIR = path.join(__dirname, '../public/locales');
const EN_DIR = path.join(LOCALES_DIR, 'en');

/**
 * Flattens a nested object into a flat dictionary with dot-notation keys.
 */
function flattenObject(obj: Record<string, any>, prefix = ''): Record<string, string> {
  return Object.keys(obj).reduce((acc: Record<string, string>, k: string) => {
    const pre = prefix.length ? prefix + '.' : '';
    if (typeof obj[k] === 'object' && obj[k] !== null && !Array.isArray(obj[k])) {
      Object.assign(acc, flattenObject(obj[k], pre + k));
    } else {
      acc[pre + k] = obj[k];
    }
    return acc;
  }, {});
}

/**
 * Sets a value in a nested object based on a dot-notation key path.
 */
function setNestedValue(obj: Record<string, any>, keyPath: string, value: string) {
  const keys = keyPath.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (!current[k]) current[k] = {};
    current = current[k];
  }
  current[keys[keys.length - 1]] = value;
}

describe('i18n translations completeness', () => {
  it('should have all keys in all supported languages with <= 5% missing', () => {
    const enCommonPath = path.join(EN_DIR, 'common.json');
    const enCommon = JSON.parse(fs.readFileSync(enCommonPath, 'utf-8'));
    const enKeys = flattenObject(enCommon);
    const totalEnKeys = Object.keys(enKeys).length;

    // Get all language directories except English
    const languages = fs
      .readdirSync(LOCALES_DIR)
      .filter((dir) => dir !== 'en' && fs.statSync(path.join(LOCALES_DIR, dir)).isDirectory());

    languages.forEach((lang) => {
      const langCommonPath = path.join(LOCALES_DIR, lang, 'common.json');
      let langCommon: Record<string, any> = {};

      if (fs.existsSync(langCommonPath)) {
        langCommon = JSON.parse(fs.readFileSync(langCommonPath, 'utf-8'));
      }

      const langKeys = flattenObject(langCommon);
      let missingCount = 0;
      const missingKeyPaths: string[] = [];
      let wasModified = false;

      // Verify every key in en/ exists in this language namespace
      Object.entries(enKeys).forEach(([keyPath, enValue]) => {
        if (!(keyPath in langKeys)) {
          missingCount++;
          missingKeyPaths.push(keyPath);
          // Auto-generate stub translations for missing keys (marked [TRANSLATE])
          setNestedValue(langCommon, keyPath, `[TRANSLATE] ${enValue}`);
          wasModified = true;
        }
      });

      // Write changes back to auto-generate stubs if any keys were missing
      if (wasModified) {
        fs.writeFileSync(langCommonPath, JSON.stringify(langCommon, null, 2) + '\n', 'utf-8');
      }

      const missingPercentage = missingCount / totalEnKeys;

      // Reports missing keys per language
      if (missingCount > 0) {
        console.warn(
          `Language '${lang}' is missing ${missingCount} keys (${(missingPercentage * 100).toFixed(2)}%):\n${missingKeyPaths.map((k) => `  - ${k}`).join('\n')}`
        );
      }

      // CI fails if any language is missing > 5% of keys
      expect(missingPercentage).toBeLessThanOrEqual(0.05);
    });
  });
});
