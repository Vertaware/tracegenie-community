import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter,RouterProvider } from "react-router-dom";

import { App } from "./app/App";
import { AppErrorBoundary } from "./app/AppErrorBoundary";
import { AdminFormExitGuardProvider } from "./components/guards/AdminFormExitGuard";
import { queryClient } from "./lib/queryClient";
import "./styles/index.css";

const router = createBrowserRouter([
  {
    path: "*",
    element: (
      <AdminFormExitGuardProvider>
        <App />
      </AdminFormExitGuardProvider>
    ),
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AppErrorBoundary>
  </React.StrictMode>,
);
