const noExternalScriptWithoutSri = require("./rules/no-external-script-without-sri");
const noRawDangerouslySetInnerHtml = require("./rules/no-raw-dangerously-set-inner-html");

module.exports = {
  rules: {
    "no-external-script-without-sri": noExternalScriptWithoutSri,
    "no-raw-dangerously-set-inner-html": noRawDangerouslySetInnerHtml,
  },
  configs: {
    recommended: {
      plugins: ["sri"],
      rules: {
        "sri/no-external-script-without-sri": "error",
      },
    },
  },
};
