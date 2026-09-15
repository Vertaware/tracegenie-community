import assert from "node:assert/strict";
import test from "node:test";
import { hasCustomerStatusRecipient } from "../src/constants/feedback";

test("only an enabled, reachable reporter requires a customer status update", () => {
  const ticket = { reporterEmail: "customer@example.test", requesterNotificationsEnabled: true, subscribers: [] };
  assert.equal(hasCustomerStatusRecipient(ticket), true);
  assert.equal(hasCustomerStatusRecipient({ ...ticket, reporterEmail: null }), false);
  assert.equal(hasCustomerStatusRecipient({ ...ticket, reporterEmail: "  " }), false);
  assert.equal(hasCustomerStatusRecipient({ ...ticket, requesterNotificationsEnabled: false }), false);
});

test("external followers count, but internal and inactive followers do not", () => {
  const subscriber = { email: "customer@example.test", recipientType: "external_subscriber", isActive: true, notifyOnStatusChange: true };
  const ticket = { reporterEmail: null, requesterNotificationsEnabled: false, subscribers: [subscriber] };
  assert.equal(hasCustomerStatusRecipient(ticket), true);
  assert.equal(hasCustomerStatusRecipient({ ...ticket, subscribers: [{ ...subscriber, recipientType: "EXTERNAL_SUBSCRIBER" }] }), true);
  assert.equal(hasCustomerStatusRecipient({ ...ticket, subscribers: [{ ...subscriber, recipientType: "internal_subscriber" }] }), false);
  assert.equal(hasCustomerStatusRecipient({ ...ticket, subscribers: [{ ...subscriber, isActive: false }] }), false);
  assert.equal(hasCustomerStatusRecipient({ ...ticket, subscribers: [{ ...subscriber, email: " " }] }), false);
});

test("external followers follow the existing status-delivery eligibility, including anonymous handoffs", () => {
  const subscriber = { email: "customer@example.test", recipientType: "external_subscriber", isActive: true, notifyOnStatusChange: false };
  const ticket = { reporterEmail: "reporter@example.test", requesterNotificationsEnabled: false, subscribers: [subscriber] };
  assert.equal(hasCustomerStatusRecipient(ticket), false);
  assert.equal(hasCustomerStatusRecipient({ ...ticket, reporterEmail: null }), true);
});
