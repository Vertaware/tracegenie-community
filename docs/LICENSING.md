# Licensing TraceGenie Community

TraceGenie Community uses **GNU Affero General Public License version 3 only**, identified as `AGPL-3.0-only`. [LICENSE](../LICENSE) contains the unmodified license text; [NOTICE](../NOTICE) identifies the project and copyright. These terms apply to the first-party server, consumer app, widget, shared code, email package and documentation, except material identified under another license.

## Can businesses use Community?

Yes. Commercial use is allowed under the AGPL without a license fee to TraceGenie when its conditions are met. Community is not restricted to noncommercial projects or open-source customer applications.

For enquiries about alternative commercial terms, visit [traceitgenie.com](https://traceitgenie.com). Alternative permissions require a separate written agreement from the relevant rights holders. This repository does not supply that agreement, promise its availability for every contribution, or require AGPL-compliant businesses to buy it.

## What must be shared?

Redistributing covered software requires preserving the applicable license and notices and satisfying the AGPL's source requirements. If you modify the program and users interact with that version over a network, section 13 requires a prominent opportunity for those users to obtain its Corresponding Source. That source includes the material needed to build, install, run and modify the covered version.

This is a summary; the license controls. See sections 4–6 and 13 of [LICENSE](../LICENSE).

## Does my whole app have to use AGPL?

Not automatically. A separate application communicating with a TraceGenie server is not automatically the same covered work. Incorporating or linking the AGPL widget into application code can raise different combined-work questions. No blanket widget linking exception is granted here. Review your integration and obtain legal advice when the boundary matters; using a script tag alone is not a guarantee of exemption.

Private reports, uploads, credentials and customer databases do not become source code that must be published merely because they are stored in TraceGenie. Do not include them in source distributions.

## Distributing builds

Distribute the matching Corresponding Source and build instructions with, or through equivalent access alongside, downloadable covered binaries. The release packager builds from a source snapshot and includes that same snapshot as `source.tar.gz`, together with `LICENSE`, `NOTICE` and this guide. Publish the source archive wherever you publish the corresponding image or widget bundle. A future public repository link must identify the exact released version; a link to a moving branch is insufficient evidence of a match.

For npm publication, retain the widget's `LICENSE` and `NOTICE` and provide access to the matching source, including the shared code and build configuration it requires. If you host a modified version, add a prominent source offer accessible to its remote users. A private operator-only archive is not a substitute for that offer.

Local release archives prepared before this change retain their earlier contents. Rebuild before distribution; do not relabel an old image as an AGPL build. Changing this checkout does not revoke permissions already granted for copies previously distributed under other terms.

Third-party dependencies retain their own licenses. Preserve their notices, including [Motion's notices](../packages/shared/MOTION-LICENSE-NOTICE.txt). The Community license change does not relicense those dependencies or the separate TraceGenie SaaS repository.

## Maintainer responsibilities

Confirm rights to all included first-party code and contributions before publication or offering alternative commercial terms. Review widget integration guidance and any separate commercial agreement with licensing counsel. This guide explains the chosen project policy; it is not a legal opinion about a particular deployment.

References: [GNU AGPL v3](https://www.gnu.org/licenses/agpl-3.0.html), [GNU licensing FAQ](https://www.gnu.org/licenses/gpl-faq.html), [SPDX identifier](https://spdx.org/licenses/AGPL-3.0-only.html).
