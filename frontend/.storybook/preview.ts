import type { Preview } from "@storybook/react";
import "../styles/globals.css";
import { getDirection } from "../lib/direction";

const preview: Preview = {
  // Toolbar "Direction" toggle. "Pseudo-RTL" (en-XB) keeps English copy but
  // mirrors the layout, so RTL regressions can be reviewed without a translation.
  globalTypes: {
    direction: {
      description: "Text direction / pseudo-RTL review",
      defaultValue: "ltr",
      toolbar: {
        title: "Direction",
        icon: "transfer",
        items: [
          { value: "ltr", title: "LTR (en)" },
          { value: "rtl", title: "Pseudo-RTL (en-XB)" },
          { value: "ar", title: "Arabic (ar)" },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const choice = String(context.globals.direction ?? "ltr");
      const locale = choice === "rtl" ? "en-XB" : choice === "ar" ? "ar" : "en";
      const dir = getDirection(locale);
      if (typeof document !== "undefined") {
        document.documentElement.dir = dir;
        document.documentElement.lang = locale;
      }
      return Story();
    },
  ],
  parameters: {
    backgrounds: {
      default: "dark",
      values: [
        { name: "dark", value: "#0c0a06" },
        { name: "light", value: "#fafaf8" },
      ],
    },
  },
};

export default preview;
