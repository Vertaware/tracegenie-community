# TraceGenie Community

The existing TraceGenie consumer app and widget, extracted for **one project per installation**. It retains the original screens, design system, screenshot capture and privacy editor, issue workflow, comments, attachments, notifications, and secure reporter replies.

## Install for self-hosting

Use the Docker release installer. It starts the full application from prebuilt images, creates your owner account in the browser, and includes backup, restore and upgrade commands. See [the self-hosting guide](docs/SELF_HOSTING.md). Release archives are prepared locally; public GitHub/registry distribution is not configured yet.

## Run locally (development)

Install Node 24 and Docker, then run:

```sh
npm install
npm run dev
```

The command creates a fresh local PostgreSQL database and mail inbox, generates private local credentials, applies migrations, seeds one project, builds the original workspaces and starts the services. It uses no existing TraceGenie database or credentials.

- Consumer app: http://127.0.0.1:4311
- Widget preview: http://127.0.0.1:4312/?projectKey=community
- Hosted feedback: http://127.0.0.1:4312/?projectKey=community&mode=feedback
- Local email inbox: http://127.0.0.1:14325
- Local login: `.local/login.txt`

`npm run stop` stops this installation. It preserves the database and uploads. `npm run setup` initializes the installation without starting the app. Customize the single project in its existing settings screens.

## Email settings

Open **Settings → Email** as an installation administrator. Choose **Resend**, enter your own API key, sender name, sender email and optional reply-to mailbox, then select **Save and send test email**. Resend's SMTP host, port, username and TLS settings are filled in automatically. Create the key and verify your sending domain in your own [Resend account](https://resend.com/docs/send-with-smtp).

The test goes only to the signed-in administrator's email address. A successful test means the mail server accepted it; check your inbox and spam folder. If the test fails, the page explains the failure and clearly says when the settings were saved. **Save settings** also lets you save without sending. **Other SMTP (advanced)** supports another provider or a local relay; authenticated SMTP requires TLS.

Saved settings take precedence over the SMTP environment variables and apply to the API and background worker on their next send, without a restart. Notifications, access codes, password resets, reporter replies and queued retries use this configuration. **Use server settings instead** removes the saved override and restores the environment configuration.

Credentials are encrypted in a separate installation record. The API returns only whether a credential is saved, never its value or ciphertext. Editing sender details preserves the existing credential; changing provider, host or username requires entering the credential again. Only active installation owners/admins can view or change these settings. Public widget and reporter configuration does not include mail credentials.

`npm run setup` / `npm run dev` generates a private `EMAIL_SETTINGS_ENCRYPTION_KEY` in the root `.env`, including for existing local installs. Keep that key stable and back it up securely with the database: losing or changing it requires restoring it or replacing the saved email credential. For a manual deployment, generate 32 random bytes as 64 hexadecimal characters and provide the same key to the API and worker. Never use a `VITE_` variable for secrets.

The default local environment sends to Mailpit and needs no external email account. `.env` is excluded from Git. Environment variables remain available as a fallback:

```dotenv
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=resend
SMTP_PASSWORD=YOUR_RESEND_API_KEY
EMAIL_FROM=TraceGenie Community <notifications@yourdomain.com>
REQUESTER_EMAIL_FROM_EMAIL=notifications@yourdomain.com
REQUESTER_EMAIL_REPLY_TO=support@yourdomain.com
```

Use a verified domain for both sender addresses and a monitored reply-to mailbox. Changes made directly to environment variables require restarting the API and worker. There is no separate `RESEND_API_KEY` setting. Live Resend delivery has not been tested; local verification uses Mailpit.

## Scope

One project is enforced by the database. The original organization and membership records serve as internal installation and team boundaries. There is no organization creation, project creation, platform administration, billing, MCP server, survey service, ideas service, or external integration service.

The original backend and shared contracts are retained where needed by the consumer and widget. Local file storage replaces Azure storage. SMTP replaces the hosted email transport while preserving templates and notification retries. The local mail inbox catches all test messages.

The npm workflow is for local development; Docker releases use the self-hosting guide above. Publishing to GitHub and a public registry remains a separate step. No Git remote is configured.

## Verification

After local setup:

```sh
npm run check:repo
npm run typecheck
npm test
npm run build
```

`npm test` runs the retained shared tests, database-backed OTP and idempotency checks, email credential/runtime and UI checks, attachment validation, and widget capture/privacy/session checks. The command defines the supported Community regression suite. Some retained historical tests still need adaptation to single-project behavior; running every test file indiscriminately is not the release gate.

See [Contributing](CONTRIBUTING.md) for repository checks and test scope. Generated output, credentials, local recovery archives and verification receipts belong under `.local/` and are excluded from Git. Implementation tickets are maintained in `backlog/`.

## Motion design system

The consumer and widget use shared motion tokens and MIT-licensed Motion for React. Open [the motion playground](http://127.0.0.1:4311/motion.html) during local development to try the actual components and a mock report submission. See [the motion guide](docs/MOTION_SYSTEM.md) for the component audit, recipes and accessibility behavior. `npm run test:motion-ui` and `npm run test:widget-flow` are included in `npm test`.

## License

[GNU Affero General Public License v3.0 only (AGPL-3.0-only)](LICENSE).

Community is free to use, including commercially, when you comply with the AGPL. Its source-sharing obligations apply to covered distributions and modified versions used over a network. For enquiries about alternative commercial terms, visit [traceitgenie.com](https://traceitgenie.com).

See [Licensing](docs/LICENSING.md) for the widget/server distinction and distribution requirements. Third-party packages retain their own licenses and notices.
