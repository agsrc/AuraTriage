import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  // The contract test runs in a plain Node environment, where there is no window.
  if (typeof window !== "undefined") {
    window.sessionStorage.clear();
  }
});
