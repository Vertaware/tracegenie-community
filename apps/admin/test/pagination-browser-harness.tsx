import { useState } from "react";
import { createRoot } from "react-dom/client";

import { Pagination } from "../src/components/ui/Pagination";
import "../src/styles/index.css";

const parameters = new URLSearchParams(window.location.search);
const initialPage = Number(parameters.get("page") ?? 5);
const pageCount = Number(parameters.get("pageCount") ?? 10);
const total = Number(parameters.get("total") ?? 100);
const pageSize = Number(parameters.get("pageSize") ?? 10);

function PaginationBrowserHarness() {
  const [page, setPage] = useState(initialPage);

  return (
    <main id="pagination-browser-harness" className="min-h-screen bg-surface py-8">
      <section id="pagination-proof-surface" className="mx-auto w-full max-w-5xl overflow-hidden border border-border/25">
        <Pagination
          page={page}
          pageCount={pageCount}
          total={total}
          pageSize={pageSize}
          onPage={setPage}
        />
      </section>
    </main>
  );
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Pagination browser harness root is missing.");
}

createRoot(root).render(<PaginationBrowserHarness />);
