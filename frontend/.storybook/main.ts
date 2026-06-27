import type { StorybookConfig } from "@storybook/nextjs";

const config: StorybookConfig = {
  stories: ["../stories/**/*.stories.tsx"],
  addons: ["@storybook/addon-essentials"],
  framework: {
    name: "@storybook/nextjs",
    options: {},
  },
};

export default config;
