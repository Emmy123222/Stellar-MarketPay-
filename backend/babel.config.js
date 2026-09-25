// sanitize-html's htmlparser2 dependency chain ships ESM-only, so Jest needs
// this to transform it to CommonJS (see transformIgnorePatterns in package.json).
module.exports = {
  presets: [["@babel/preset-env", { targets: { node: "current" } }]],
};
