/**
 * @fileoverview Disallow external <script> tags without an integrity attribute (SRI).
 * @author Stellar MarketPay Security
 */

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        'Require integrity and crossOrigin attributes on external <script> tags loaded via next/script or <script src="...">',
      recommended: true,
      url: "https://github.com/Stellar-MarketPay/Stellar-MarketPay/issues/531",
    },
    messages: {
      missingIntegrity:
        'External script "{{src}}" is missing an integrity attribute. Add integrity="sha256-..." and crossOrigin="anonymous" per SRI policy.',
    },
    schema: [],
  },

  create(context) {
    const CDN_HOSTS = [
      "fonts.googleapis.com",
      "fonts.gstatic.com",
      "cdn.jsdelivr.net",
      "unpkg.com",
      "cdnjs.cloudflare.com",
      "ajax.googleapis.com",
      "stackpath.bootstrapcdn.com",
      "maxcdn.bootstrapcdn.com",
      "use.fontawesome.com",
      "kit.fontawesome.com",
    ];

    function isExternalUrl(url) {
      try {
        const parsed = new URL(url);
        return (
          parsed.protocol === "https:" &&
          CDN_HOSTS.some(
            (host) =>
              parsed.hostname === host || parsed.hostname.endsWith("." + host)
          )
        );
      } catch {
        return false;
      }
    }

    function isExternalScript(node) {
      if (node.type !== "JSXElement") return false;

      const name = node.openingElement?.name;
      if (!name) return false;

      const tagName =
        name.type === "JSXIdentifier" ? name.name : null;
      if (tagName !== "script" && tagName !== "Script") return false;

      const attrs = node.openingElement.attributes;
      const srcAttr = attrs.find(
        (a) => a.type === "JSXAttribute" && a.name?.name === "src"
      );

      if (!srcAttr || !srcAttr.value) return false;

      const srcValue =
        srcAttr.value.type === "Literal"
          ? srcAttr.value.value
          : srcAttr.value.type === "JSXExpressionContainer" &&
            srcAttr.value.expression.type === "Literal"
          ? srcAttr.value.expression.value
          : null;

      if (typeof srcValue !== "string") return false;

      return isExternalUrl(srcValue);
    }

    function hasIntegrity(node) {
      const attrs = node.openingElement.attributes;
      return attrs.some(
        (a) => a.type === "JSXAttribute" && a.name?.name === "integrity"
      );
    }

    function getSrcValue(node) {
      const attrs = node.openingElement.attributes;
      const srcAttr = attrs.find(
        (a) => a.type === "JSXAttribute" && a.name?.name === "src"
      );

      if (!srcAttr?.value) return "unknown";

      if (srcAttr.value.type === "Literal") return srcAttr.value.value;
      if (
        srcAttr.value.type === "JSXExpressionContainer" &&
        srcAttr.value.expression.type === "Literal"
      )
        return srcAttr.value.expression.value;

      return "dynamic src";
    }

    return {
      JSXElement(node) {
        if (isExternalScript(node) && !hasIntegrity(node)) {
          context.report({
            node,
            messageId: "missingIntegrity",
            data: { src: getSrcValue(node) },
          });
        }
      },
    };
  },
};
