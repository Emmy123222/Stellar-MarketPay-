import "@testing-library/jest-dom";
import "jest-axe/extend-expect";
import { TextEncoder, TextDecoder } from "util";

Object.assign(global, { TextDecoder, TextEncoder });

if (typeof window !== "undefined") {
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
}

if (typeof Element !== "undefined") {
  Element.prototype.scrollIntoView = jest.fn();
}

// jsdom does not implement IntersectionObserver — provide a no-op stub so
// components that rely on it (e.g. virtual lists, lazy-load wrappers) don't
// throw a ReferenceError during tests.
global.IntersectionObserver = class IntersectionObserver {
  root = null;
  rootMargin = "";
  thresholds = [];
  observe = jest.fn();
  unobserve = jest.fn();
  disconnect = jest.fn();
  takeRecords = (): IntersectionObserverEntry[] => [];
} as unknown as typeof IntersectionObserver;

if (typeof window !== "undefined") {
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
}

jest.mock("next/router", () => ({
  useRouter: () => ({
    pathname: "/",
    push: jest.fn(),
    query: {},
    isReady: true,
  }),
}));

// Mock @react-pdf/renderer to avoid ES module issues in Jest
jest.mock("@react-pdf/renderer", () => ({
  pdf: jest.fn(() => ({
    toBlob: jest.fn(() => Promise.resolve(new Blob())),
    toBuffer: jest.fn(() => Promise.resolve(Buffer.from(""))),
  })),
  Font: {
    register: jest.fn(),
  },
  StyleSheet: {
    create: jest.fn((styles) => styles),
  },
  View: ({ children }: any) => children,
  Text: ({ children }: any) => children,
  Document: ({ children }: any) => children,
  Page: ({ children }: any) => children,
  BlobProvider: ({ children }: any) => children({ blob: new Blob(), url: "" }),
  renderToBuffer: jest.fn(() => Promise.resolve(Buffer.from("%PDF-1.4\\nmock"))),
}));

// Mock HTMLCanvasElement for jest-axe tests
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = jest.fn() as any;
}
