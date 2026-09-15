# Email configuration

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
