# Demo accounts (local development only)

The mock backend seeds three accounts the first time it runs (and adds any that are missing from a browser that already holds users). They exist only in this browser's local storage and are defined in `../demo-accounts.ts`.

| Role | Email | Purpose |
|---|---|---|
| Customer | `demo@shop.test` | Try sign in, profile, addresses, orders |
| Admin | `admin@shop.test` | Used by the admin app later; has admin permissions |
| Seller | `seller@shop.test` | Signs in to the seller app (port 4202); owns the demo store "Urban Threads" |

Passwords are in `demo-accounts.ts`. Real accounts registered in the mock are stored with a salted hash, never in plain text. Emails are not sent: open the demo mailbox at `/dev/mailbox` (development builds only) to see verification, reset and order emails.
