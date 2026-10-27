import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeApi, renderApp, storeSession } from "./support/fixtures";

describe("routes", () => {
  it("serves the patient portal at /", () => {
    renderApp(fakeApi(), "/");

    expect(screen.getByRole("heading", { name: "Welcome to AuraTriage" })).toBeInTheDocument();
    expect(document.title).toBe("AuraTriage · Patient portal");
  });

  it("serves the nurse dashboard at /nurse", () => {
    renderApp(fakeApi(), "/nurse");

    expect(screen.getByRole("heading", { name: "Nurse dashboard" })).toBeInTheDocument();
    expect(document.title).toBe("AuraTriage · Nurse dashboard");
  });

  it("shows a not-found page with a way back", () => {
    renderApp(fakeApi(), "/nowhere");

    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to the patient portal" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("does not show a nurse session in the patient portal", () => {
    storeSession("nurse");
    renderApp(fakeApi(), "/");

    expect(screen.getByRole("heading", { name: "Welcome to AuraTriage" })).toBeInTheDocument();
  });

  it("always shows the demonstration disclaimer", () => {
    renderApp(fakeApi(), "/");

    expect(screen.getByText(/Not medical advice and not a medical device/)).toBeInTheDocument();
  });
});
