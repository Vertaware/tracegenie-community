import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

import { LoginPage } from "../src/features/auth/LoginPage";
import "../src/styles/index.css";

createRoot(document.getElementById("root")!).render(
  <MemoryRouter initialEntries={["/login"]}>
    <LoginPage loading={false} onLogin={async () => undefined} />
  </MemoryRouter>,
);
