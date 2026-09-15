import { useState } from "react";
import type { FeedbackDetailResponse } from "@tracegenie/shared";

import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";

type FeedbackSubscribersCardProps = {
  detail: FeedbackDetailResponse;
  newSubscriberEmail: string;
  newSubscriberName: string;
  newSubscriberNotifyOnStatusChange: boolean;
  newSubscriberNotifyOnTriage: boolean;
  newSubscriberRecipientType: string;
  addingSubscriber: boolean;
  onAddingSubscriberChange: (adding: boolean) => void;
  onAddSubscriber: () => void;
  onNewSubscriberEmailChange: (value: string) => void;
  onNewSubscriberNameChange: (value: string) => void;
  onNewSubscriberNotifyOnStatusChangeChange: (value: boolean) => void;
  onNewSubscriberNotifyOnTriageChange: (value: boolean) => void;
  onNewSubscriberRecipientTypeChange: (value: string) => void;
  onRemoveSubscriber: (subscriberId: string) => void;
  onToggleSubscriberStatus: (subscriberId: string, nextValue: boolean) => void;
  onToggleSubscriberTriage: (subscriberId: string, nextValue: boolean) => void;
  onUpdateSubscriberType: (subscriberId: string, nextValue: string) => void;
  savingSubscriber: boolean;
};

function formatRecipientType(value: string) {
  return value.replaceAll("_", " ");
}

export function FeedbackSubscribersCard({
  detail,
  newSubscriberEmail,
  newSubscriberName,
  newSubscriberNotifyOnStatusChange,
  newSubscriberNotifyOnTriage,
  newSubscriberRecipientType,
  addingSubscriber,
  onAddingSubscriberChange,
  onAddSubscriber,
  onNewSubscriberEmailChange,
  onNewSubscriberNameChange,
  onNewSubscriberNotifyOnStatusChangeChange,
  onNewSubscriberNotifyOnTriageChange,
  onNewSubscriberRecipientTypeChange,
  onRemoveSubscriber,
  onToggleSubscriberStatus,
  onToggleSubscriberTriage,
  onUpdateSubscriberType,
  savingSubscriber,
}: FeedbackSubscribersCardProps) {
  const [editingSubscriberId, setEditingSubscriberId] = useState<string | null>(null);
  const subscribers = detail.feedback.subscribers;
  const activeSubscriberCount = subscribers.filter((subscriber) => subscriber.isActive).length;
  const reporterEmail = detail.feedback.reporter.email?.trim() || null;
  const reporterName = detail.feedback.reporter.name?.trim() || reporterEmail;

  return (
    <div id="detail-subscribers-card" className="rounded-2xl bg-surface-muted/35 p-4">
      <div id="subscribers-card-header" className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-label font-semibold text-foreground">Notifications</p>
          <p className="mt-0.5 text-caption text-muted">
            {activeSubscriberCount === 0
              ? reporterEmail
                ? detail.feedback.requesterNotificationsEnabled ? "Reporter only" : "Reporter updates paused"
                : "No email recipients"
              : `${activeSubscriberCount} ${reporterEmail ? "additional " : ""}recipient${activeSubscriberCount === 1 ? "" : "s"}`}
          </p>
        </div>
        <Button tone="secondary" onClick={() => onAddingSubscriberChange(!addingSubscriber)}>
          {addingSubscriber ? "Close" : "Add recipient"}
        </Button>
      </div>

      <div id="requester-recipient-summary" className="tg-entry-card mt-4 flex items-center justify-between gap-3 rounded-2xl bg-surface px-3.5 py-3 shadow-soft">
        {reporterName ? <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-label font-medium text-foreground">{reporterName}</p>
            <Badge tone="neutral">reporter</Badge>
            {reporterEmail ? <Badge tone={detail.feedback.requesterNotificationsEnabled ? "primary" : "neutral"}>
              {detail.feedback.requesterNotificationsEnabled ? "Updates enabled" : "Updates paused"}
            </Badge> : null}
          </div>
          <p className="mt-1 break-words text-caption text-muted">{reporterEmail ?? "No email provided."}</p>
        </div> : <p className="text-label text-muted">No contact details provided.</p>}
      </div>

      {subscribers.length > 0 ? <div id="subscriber-list-section" className="mt-3 space-y-2.5">
        {subscribers.map((subscriber) => {
            const isEditing = editingSubscriberId === subscriber.id;

            return (
              <div key={subscriber.id} className="tg-entry-card rounded-2xl bg-surface px-3.5 py-3 shadow-soft">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-label font-medium text-foreground">{subscriber.name ?? "Unnamed subscriber"}</p>
                      <Badge tone="neutral">{formatRecipientType(subscriber.recipientType)}</Badge>
                      <Badge tone={subscriber.isActive ? "primary" : "neutral"}>
                        {subscriber.isActive ? "active" : "inactive"}
                      </Badge>
                    </div>
                    <p className="mt-1 truncate text-caption text-muted">{subscriber.email}</p>
                    <p className="mt-1 text-caption text-muted">
                      {subscriber.notifyOnTriage ? "Triage" : "No triage"}
                      {" · "}
                      {subscriber.notifyOnStatusChange ? "Status" : "No status"}
                    </p>
                  </div>
                  <Button
                    tone="secondary"
                    onClick={() => setEditingSubscriberId(isEditing ? null : subscriber.id)}
                    disabled={savingSubscriber}
                  >
                    {isEditing ? "Done" : "Edit"}
                  </Button>
                </div>

                {isEditing ? (
                  <div id={`subscriber-edit-${subscriber.id}`} className="tg-panel-reveal mt-4 border-t border-border/25 pt-4">
                    <div className="subscriber-edit-field">
                      <label htmlFor={`subscriber-type-${subscriber.id}`} className="mb-2 block text-caption font-medium text-muted">
                        Recipient type
                      </label>
                      <Select
                        id={`subscriber-type-${subscriber.id}`}
                        value={subscriber.recipientType}
                        onChange={(event) => onUpdateSubscriberType(subscriber.id, event.target.value)}
                        disabled={savingSubscriber || !subscriber.isActive}
                      >
                        <option value="external_subscriber">external subscriber</option>
                        <option value="internal_subscriber">internal subscriber</option>
                      </Select>
                    </div>

                    <div className="mt-3 grid gap-2">
                      <label className="tg-choice-row flex items-center gap-3 px-3 py-2.5 text-label text-foreground">
                        <input
                          type="checkbox"
                          checked={subscriber.notifyOnTriage}
                          onChange={(event) => onToggleSubscriberTriage(subscriber.id, event.target.checked)}
                          disabled={savingSubscriber || !subscriber.isActive}
                          className="size-4 shrink-0 rounded border-border accent-brand-600"
                        />
                        <span>Receive triage updates</span>
                      </label>
                      <label className="tg-choice-row flex items-center gap-3 px-3 py-2.5 text-label text-foreground">
                        <input
                          type="checkbox"
                          checked={subscriber.notifyOnStatusChange}
                          onChange={(event) => onToggleSubscriberStatus(subscriber.id, event.target.checked)}
                          disabled={savingSubscriber || !subscriber.isActive}
                          className="size-4 shrink-0 rounded border-border accent-brand-600"
                        />
                        <span>Receive status updates</span>
                      </label>
                    </div>

                    <div id={`subscriber-edit-actions-${subscriber.id}`} className="mt-3 flex justify-end">
                      <Button
                        tone="secondary"
                        onClick={() => onRemoveSubscriber(subscriber.id)}
                        disabled={savingSubscriber || !subscriber.isActive}
                      >
                        Disable
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
      </div> : null}

      {addingSubscriber ? (
        <div id="subscriber-add-section" role="group" aria-label="Add recipient" className="tg-panel-reveal mt-4 scroll-mt-24 border-t border-border/25 pt-4">
          <p className="text-caption font-medium text-muted">Add recipient</p>
          <div id="subscriber-add-grid" className="mt-3 grid gap-3">
            <div className="subscriber-add-field">
              <label htmlFor="new-subscriber-name" className="mb-2 block text-caption font-medium text-muted">
                Name
              </label>
              <Input
                id="new-subscriber-name"
                value={newSubscriberName}
                onChange={(event) => onNewSubscriberNameChange(event.target.value)}
                placeholder="Alicia Product"
              />
            </div>

            <div className="subscriber-add-field">
              <label htmlFor="new-subscriber-email" className="mb-2 block text-caption font-medium text-muted">
                Email
              </label>
              <Input
                id="new-subscriber-email"
                type="email"
                value={newSubscriberEmail}
                onChange={(event) => onNewSubscriberEmailChange(event.target.value)}
                placeholder="alicia@example.com"
              />
            </div>

            <div className="subscriber-add-field">
              <label htmlFor="new-subscriber-type" className="mb-2 block text-caption font-medium text-muted">
                Recipient type
              </label>
              <Select
                id="new-subscriber-type"
                value={newSubscriberRecipientType}
                onChange={(event) => onNewSubscriberRecipientTypeChange(event.target.value)}
              >
                <option value="external_subscriber">external subscriber</option>
                <option value="internal_subscriber">internal subscriber</option>
              </Select>
            </div>
          </div>

          <div id="subscriber-add-preferences" className="mt-3 grid gap-2">
            <label className="tg-choice-row flex items-center gap-3 px-3 py-2.5 text-label text-foreground">
              <input
                type="checkbox"
                checked={newSubscriberNotifyOnTriage}
                onChange={(event) => onNewSubscriberNotifyOnTriageChange(event.target.checked)}
                className="size-4 shrink-0 rounded border-border accent-brand-600"
              />
              <span>Receive triage updates</span>
            </label>
            <label className="tg-choice-row flex items-center gap-3 px-3 py-2.5 text-label text-foreground">
              <input
                type="checkbox"
                checked={newSubscriberNotifyOnStatusChange}
                onChange={(event) => onNewSubscriberNotifyOnStatusChangeChange(event.target.checked)}
                className="size-4 shrink-0 rounded border-border accent-brand-600"
              />
              <span>Receive status updates</span>
            </label>
          </div>

          <div id="subscriber-add-actions" className="mt-3">
            <Button
              onClick={onAddSubscriber}
              disabled={savingSubscriber || !newSubscriberEmail.trim()}
            >
              {savingSubscriber ? "Saving..." : "Add recipient"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
