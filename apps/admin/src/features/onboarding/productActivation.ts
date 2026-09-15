import type { ProjectInstallDiagnosticsResponse } from "@tracegenie/shared";

/** Use the same saved evidence for setup progress and the product landing page. */
export function productCaptureReadiness(diagnostics: ProjectInstallDiagnosticsResponse | null | undefined) {
  const installed = ["origin", "session"].every((id) => {
    const status = diagnostics?.proofs.find((proof) => proof.id === id)?.status;
    return status === "configured" || status === "verified";
  });
  const captured = installed && diagnostics?.proofs.find((proof) => proof.id === "first_report")?.status === "verified";
  return { installed, captured };
}
