import type { Preview } from "@storybook/react";
import "../styles/globals.css";

const preview: Preview = {
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
