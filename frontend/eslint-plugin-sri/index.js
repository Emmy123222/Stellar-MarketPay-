const noExternalScriptWithoutSri = require("./rules/no-external-script-without-sri");

module.exports = {
  rules: {
    "no-external-script-without-sri": noExternalScriptWithoutSri,
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
