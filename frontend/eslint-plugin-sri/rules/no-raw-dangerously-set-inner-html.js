module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Require dangerouslySetInnerHTML to be used by the approved sanitizer wrapper",
    },
    schema: [],
  },
  create(context) {
    const filename = context.getFilename().replace(/\\/g, "/");
    const isApprovedWrapper = filename.endsWith("/components/SanitizedHtml.tsx");

    return {
      JSXAttribute(node) {
        if (!isApprovedWrapper && node.name.name === "dangerouslySetInnerHTML") {
          context.report({
            node,
            message: "Use the SanitizedHtml component instead of raw dangerouslySetInnerHTML.",
          });
        }
      },
    };
  },
};