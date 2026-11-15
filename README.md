# Summit Primary Academy — Full-stack school portal

This is a working full-stack application starter built with Node.js, Express and PostgreSQL. It is not just a static HTML mock-up: the browser calls a server API and records are stored in PostgreSQL.

## Included modules

- Secure sign-in with password hashing and signed, expiring JWT tokens
- Role-based access for administrator, teacher and parent
- Student register and class creation
- Staff / user account creation
- Parent-to-learner account linking
- Daily attendance
- Academic results
- Fee invoices and internal payment ledger
- School announcements
- User messaging
- Dashboard summaries
- Responsive web interface

## Requirements

- Node.js 20 or newer
- PostgreSQL 14 or newer
- VS Code (recommended)

## Run locally

1. Extract the project folder and open it in VS Code.
2. Install PostgreSQL and create a database named `summit_academy`.
3. Copy `.env.example` to `.env`.
4. Edit `.env` and set `DATABASE_URL`, `JWT_SECRET`, `ADMIN_EMAIL`, and a strong `ADMIN_PASSWORD` (at least 10 characters). Use a random secret of 32+ characters for `JWT_SECRET`.
5. In the VS Code terminal run:

   ```bash
   npm install
   npm start
   ```

6. Open `http://localhost:3000`.
7. Sign in with the administrator email and password you set in `.env`.

The server creates the database tables and the initial administrator account on first startup. The PostgreSQL database itself must already exist.

## Create parent and teacher accounts

Sign in as administrator and open **Staff & accounts**. Create a teacher or parent account with a temporary password. Give each user their own credentials.

To link a parent account to a learner, call the administrator-only endpoint after creating both records:

```bash
curl -X POST http://localhost:3000/api/students/1/link-parent \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"parent@example.com"}'
```

Replace `1`, the token, and the email with the actual values. The parent will then see only linked learners in their portal.

## Deploying

Deploy the Node application to a Node-compatible host and provision a managed PostgreSQL database. Set the environment variables from `.env.example` in the host dashboard. Set `NODE_ENV=production`, use a strong unique `JWT_SECRET`, and set `PGSSL=true` only if required by your database provider. Configure HTTPS and the correct `APP_URL`.

Do not upload `.env` or commit passwords, database URLs, tokens, or API secrets to GitHub.

## Important payment and messaging boundary

The fees module is a school accounting ledger. It lets authorized staff create invoices and record payments that have already been received. Choosing “M-Pesa (recorded manually)” is only a label; it does **not** call Safaricom, initiate STK Push, or verify a callback. A real Daraja integration needs Safaricom developer credentials, a public HTTPS callback URL, transaction validation, idempotency, reconciliation and testing.

The messages module stores portal messages. It does **not** send SMS or email. Add an approved SMS/email provider and consent/opt-out handling before enabling outbound notifications.

## Before using real learner data

This code is a substantial functional prototype / MVP foundation, not a certified production school information system. Before real deployment:
- Conduct an independent security review and penetration test.
- Add password reset, MFA for privileged users, refresh-token/session revocation, audit logs and account lockout.
- Add finer teacher/class permissions and parent identity verification.
- Add backups, restore drills, monitoring, log redaction and disaster recovery.
- Review Kenya Data Protection Act obligations, children's data safeguards, retention schedules, notices, consent/legal basis, processor contracts and access controls with qualified counsel / the school's data protection lead.
- Validate all forms, date handling, reporting and financial workflows with the school.
- Use HTTPS, secure hosting, least-privilege database credentials and separate staging/production environments.

The displayed school name is fictional placeholder content. Replace it with the client's authorized name, logo, contacts, grading rules, class structure, fee policy and approved privacy notice.
