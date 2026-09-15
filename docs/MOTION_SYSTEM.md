# Community motion system

Implemented locally on 2026-09-14. The original consumer and widget layouts remain the product; this adds a reusable animation layer and an interactive development playground.

Open http://127.0.0.1:4311/motion.html while `npm run dev` is running. It uses the actual shared controls and actual FeedbackWidget. Its isolated mock endpoint makes submissions safe to try: no report is persisted and no email is sent. The standalone development HTML entry is not part of the production application build.

## Foundation and sources

- [Motion for React](https://motion.dev/docs/react-animate-presence) supplies interruptible springs, presence and toast layout changes. `motion@13.3.0` is pinned by the lockfile; it and its added animation dependencies are MIT licensed. Their installed notices are retained in `packages/shared/MOTION-LICENSE-NOTICE.txt` and included in the standalone widget banner.
- [Emil Kowalski’s animation guidance](https://github.com/emilkowalski/skills/tree/main/skills/animate) informed the easing, trigger origins, press feedback, enter/exit pairing, short stagger and reduced-motion behavior.
- [transitions.dev](https://github.com/Jakubantalik/transitions.dev) informed the recipe inventory: counters, menus, panels, checks, icon changes and error feedback. These Community recipes are original implementations. No Pro assets, copied recipe source, Refine relay or globally installed agent skills are included.

## Component audit and implementation

| Component / state | Before | After | Why |
| --- | --- | --- | --- |
| Primary buttons | Color change and a small press | Lift, passing highlight, springy press | Make the main action feel responsive |
| Secondary / icon / tool controls | Uneven timing | Shared press and icon kick | Consistent tactile feedback |
| Copy feedback | Green state | Check landing and finite success ring | Make completion easy to notice |
| Settings directory | Static cards | 45 ms stagger, raised hover, tilted icons | Give the directory personality |
| Sidebar | Static active background | Active marker and icon landing | Reinforce the selected destination |
| Page navigation | Content replacement | Short fade/reveal on pathname change | Connect adjacent screens without remounting drafts |
| Account menu | Instant removal | Anchor-aware spring entry and short exit | Keep the menu connected to its trigger |
| Table column filters | Entrance only | Trigger-origin entry, inert exit and focus return | Preserve filtering usability |
| Confirm dialogs | Entrance only | Spring entry, coordinated backdrop and actual exit | Give decisions visual weight |
| Unsaved-change guard | Instant dismissal | Same dialog motion, original draft/focus behavior | Keep editing reliable |
| Mobile navigation | Abrupt removal | Directional drawer entry and exit | Match the edge it comes from |
| Toasts | Entrance only, 4 s visual timer for 8 s lifetime | Spring entry, stack position changes, exit, synchronized 8 s progress | Show real lifecycle; hover/focus still pause dismissal |
| Issue count | Text replacement | Short rolling count transition | Make a changed total legible |
| Status | Color transition | Label/dot reveal on status change | Signal the new state |
| Inputs | Existing ring | Coordinated border/glow and adjacent-label color | Show focus while typing stays stationary |
| Checkboxes / radios | Native state switch | Short checked-state pop | Confirm a deliberate selection |
| Switch / tab primitives | Generic transitions | Spring thumb recipe and selected icon feedback | Reusable state-change treatments |
| Disclosures | Native snap | Content reveal; progressive height interpolation where supported | Preserve the native semantics while revealing detail |
| Dirty bars / banners | Mixed entrance speeds | Shared entrance language | Keep asynchronous feedback consistent |
| Error feedback | Generic entrance | Small finite nudge on new alert/error | Draw attention without a repeating shake |
| Empty-state icons | Soft fade/pop | A fuller landing | Give first-use states some character |
| Progress fills | Existing transition | Shared eased progress | Maintain continuity during work |
| Screenshot previews | Small zoom | Slightly richer hover zoom | Suggest inspectability |
| Widget launcher | Small lift | Lift/tilt, icon kick and press | Give the entry point a recognizable feel |
| Widget sheet | Entrance only | Spring sheet + scrim entry and real closing exit | Make it feel attached to the launcher |
| Widget fields / footer | Plain appearance | Short, capped stagger | Guide attention through the report form |
| Widget discard state | Content swap | Content reveal, existing keep-editing behavior | Clarify the change of state |
| Report success | Simple pop | Check draw, finite particle burst, staggered ticket/copy/actions | Reward completion |
| Reduced motion | CSS-only snap | Live preference subscription, zero transform travel, short fades and no particles | Covers JS animations and portals too |

## Reusing it

Import browser components from `@tracegenie/shared/motion`, not the shared root entry. This keeps React animation code out of API imports. The API compiler excludes this browser-only TSX file from its broad shared-source include.

```tsx
import { MotionPresence, MotionSurface } from "@tracegenie/shared/motion";

<MotionPresence>
  {open ? (
    <MotionSurface key="panel" kind="popover" className="your-panel">
      <p>Your content</p>
    </MotionSurface>
  ) : null}
</MotionPresence>
```

Keep `MotionPresence` mounted outside the conditional. `MotionSurface` immediately marks departing content inert, aria-hidden and non-interactive; it removes the element after exit. It does not implement dialog focus management: use the existing ConfirmDialog or menu/drawer behavior with it. The existing components own Escape, focus trapping, focus return and scroll locking.

Available kinds: fade, popover, dialog, drawer, sheet, toast and reveal. `MotionPage` animates an existing wrapper when its `path` changes; it does not key/remount the Outlet. `MotionNumber` handles counts. `MotionCelebration` creates a finite decorative burst.

CSS recipes live in `apps/admin/src/styles/motion.css` and the namespaced widget stylesheet. Shared tokens live in `packages/shared/src/motion.css`; JS timing/spring constants live in `packages/shared/src/motion.tsx`. Typical responses use 140–320 ms; spring settlement is physics based; the completion burst lasts 700 ms plus a maximum 70 ms stagger. Hover effects require a fine pointer. Reduced motion is respected reactively, including when enabled mid-animation. No continuous decorative background or pointer-following animation was introduced.

Native select option menus remain browser controlled. Disclosure height interpolation is a progressive enhancement; unsupported browsers retain native opening with content reveal. Capture targeting and screenshot masking coordinates are unchanged.

## Verification

Run `npm run test:motion-ui` for the shared controls. With the local app running, `node scripts/verify-motion.mjs` writes browser receipts to `.local/motion-verification/`. Set `CHROME_PATH` when Chrome is installed outside the default macOS location.
