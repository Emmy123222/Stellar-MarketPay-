import "@testing-library/jest-dom";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: jest.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

Element.prototype.scrollIntoView = jest.fn();

Object.defineProperty(window, "crypto", {
  configurable: true,
  value: {
    ...window.crypto,
    getRandomValues: (arr: Uint8Array) => {
      for (let i = 0; i < arr.length; i += 1) arr[i] = 0;
      return arr;
    },
    subtle: window.crypto?.subtle,
  },
});

jest.mock("next/router", () => ({
  useRouter: () => ({
    pathname: "/",
    push: jest.fn(),
    query: {},
    isReady: true,
  }),
}));
