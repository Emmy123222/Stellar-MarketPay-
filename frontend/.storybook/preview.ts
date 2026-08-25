import type { Preview } from "@storybook/react";
import "../styles/globals.css";

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: "dark",
      values: [
        { name: "dark", value: "#0c0a06" },
        { name: "surface", value: "#151208" },
      ],
    },
  },
};

export default preview;