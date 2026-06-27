import { render } from "@testing-library/react";

export function snapshotContainer(ui: React.ReactElement, name: string): void {
  const { container } = render(ui);
  expect(container.firstChild).toMatchSnapshot(name);
}
