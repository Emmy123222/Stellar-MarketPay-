module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow external script/link tags without SRI integrity attribute",
      category: "Security",
      recommended: true,
    },
    fixable: null,
    schema: [],
  },
  create: function (context) {
    const isExternalUrl = (url) => {
      return /^(https?:)?\/\//.test(url);
    };

    const checkElement = (node, tagName) => {
      if (node.name.name !== tagName) return;

      let srcHref = null;
      let hasIntegrity = false;
      let hasCrossOriginAnonymous = false;

      for (const attr of node.attributes || []) {
        if (attr.type === "JSXAttribute") {
          if (attr.name.name === "src" || attr.name.name === "href") {
            if (attr.value && attr.value.type === "Literal") {
              srcHref = attr.value.value;
            } else if (
              attr.value &&
              attr.value.type === "JSXExpressionContainer" &&
              attr.value.expression.type === "Literal"
            ) {
              srcHref = attr.value.expression.value;
            }
          }
          if (attr.name.name === "integrity") {
            hasIntegrity = true;
          }
          if (attr.name.name === "crossOrigin") {
            if (
              attr.value &&
              attr.value.type === "Literal" &&
              attr.value.value === "anonymous"
            ) {
              hasCrossOriginAnonymous = true;
            }
          }
        }
      }

      if (srcHref && isExternalUrl(srcHref)) {
        if (!hasIntegrity) {
          context.report({
            node,
            message: `External ${tagName} tag is missing SRI 'integrity' attribute.`,
          });
        }
        if (!hasCrossOriginAnonymous) {
          context.report({
            node,
            message: `External ${tagName} tag is missing 'crossOrigin=\"anonymous\"' attribute.`,
          });
        }
      }
    };

    return {
      JSXOpeningElement(node) {
        if (node.name.name === "script") {
          checkElement(node, "script");
        }
        if (node.name.name === "link") {
          checkElement(node, "link");
        }
      },
    };
  },
};
