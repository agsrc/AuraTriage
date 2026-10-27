import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { createApiClient } from "./api/client";
import { AppProviders } from "./app/context";
import "./index.css";

// Empty means same origin: the Vite dev server proxies /api to the orchestrator.
const configuredBase: unknown = import.meta.env.VITE_API_BASE_URL;
const api = createApiClient({ baseUrl: typeof configuredBase === "string" ? configuredBase : "" });

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Missing #root element");
}

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <AppProviders api={api}>
        <App />
      </AppProviders>
    </BrowserRouter>
  </StrictMode>,
);
