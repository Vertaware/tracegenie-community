import { Button } from "./Button";

type CommitBarProps = {
  isVisible: boolean;
  isPending: boolean;
  onDiscard: () => void;
  onSave: () => void;
  status: string;
  discardLabel?: string;
  saveLabel: string;
  savingLabel?: string;
  id?: string;
};

export function CommitBar({
  isVisible,
  isPending,
  onDiscard,
  onSave,
  status,
  discardLabel = "Discard",
  saveLabel,
  savingLabel = "Saving...",
  id = "commit-bar",
}: CommitBarProps) {
  if (!isVisible) {
    return null;
  }

  return (
    <aside
      id={id}
      className="tg-dirty-bar fixed bottom-0 left-0 right-0 z-30 border-t border-border/25 bg-surface/82 px-4 py-3 backdrop-blur-xl md:left-[236px]"
      aria-label={status}
    >
      <div className="mx-auto flex w-full max-w-[1440px] flex-col items-stretch gap-3 md:px-4 lg:flex-row lg:items-center lg:justify-between">
        <p className="text-label text-muted">{status}</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button className="min-h-11 w-full sm:w-auto" tone="secondary" onClick={onDiscard} disabled={isPending}>
            {discardLabel}
          </Button>
          <Button className="min-h-11 w-full sm:w-auto" onClick={onSave} disabled={isPending}>
            {isPending ? savingLabel : saveLabel}
          </Button>
        </div>
      </div>
    </aside>
  );
}
