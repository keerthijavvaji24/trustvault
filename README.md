# TrustVault

Secure document sharing and audit trail application built for the Snovasys Fresher Hiring Challenge 2026.

TrustVault is designed around server-side authorization, private document storage, per-document permissions, immediate access revocation, and an auditable record of document and permission activity.

## Features

- Supabase authentication
- Three application roles:
  - Admin
  - Owner
  - Viewer
- Secure document upload
- Private Supabase Storage
- Per-document read and edit permissions
- Owner/admin permission management
- Immediate permission revocation
- Secure document download
- Secure document update
- Secure document deletion
- Document search by:
  - name
  - owner
  - category
  - date
- Server-side file signature validation
- 10 MB upload limit
- Admin activity/audit dashboard
- Append-only audit trail
- Automated security tests
- Server-side authorization on protected API routes

---

## Security Design

TrustVault does not treat the frontend as a security boundary.

Every protected document operation performs authorization on the server using the authenticated Supabase user and the current database state.

### Authorization model

| Role | Access |
|---|---|
| Admin | Full document and audit access |
| Owner | Access to documents they own and can manage permissions |
| Viewer | Only explicitly shared documents |
| Unauthenticated | No protected access |

For viewers, document access is determined by the `document_permissions` table.

Permissions include:

- `can_read`
- `can_edit`

A viewer with read-only permission cannot update or delete a document.

### Immediate revocation

Document permissions are checked against the current database state for each protected operation.

When an owner revokes a viewer's permission:

1. The viewer no longer receives the document from the listing API.
2. Direct download access is denied.
3. The server returns a not-found/access-denied response.

This prevents a previously granted permission from remaining active through a client-side cache.

---

## Secure Document Storage

Documents are stored in a private Supabase Storage bucket.

Clients do not control:

- document ownership
- storage paths
- storage object identifiers

The server generates the storage path using the authenticated user's ID and a server-generated UUID.

Storage objects are never exposed through public URLs.

Storage access is additionally protected by Supabase Storage policies and document-level authorization.

---

## Upload Validation

The upload endpoint performs server-side validation.

Current supported file types include:

- PDF
- PNG
- JPEG
- DOCX
- plain text

Validation includes:

- authenticated user check
- role authorization
- 10 MB maximum size
- MIME allowlist
- file signature/content validation
- server-generated storage path
- server-derived document ownership

MIME type alone is not trusted because a client can provide a misleading MIME value.

---

## Audit Trail

TrustVault records security-relevant document and permission activity.

Audited operations include:

- document uploads
- document downloads
- document updates
- document deletions
- permission grants
- permission updates
- permission revocations

Audit records contain information such as:

- actor
- actor role
- action
- outcome
- document
- target user
- reason
- timestamp
- sanitized details

The actor identity and role are derived server-side rather than accepted from the client.

Direct authenticated INSERT, UPDATE, and DELETE access to the audit table is disabled.

The audit logging function also validates actions and outcomes and fails closed when its server-side audit credential is not correctly provisioned.

Sensitive values such as storage paths, tokens, passwords, and secrets are excluded from audit details.

---

## Admin Activity

Only administrators can access the audit activity API and dashboard.

The admin endpoint independently verifies the authenticated user's server-side role.

An authenticated owner or viewer cannot obtain audit activity by directly calling the API.

---

## API Security

Protected routes perform authorization independently.

Important endpoints include:

| Endpoint | Purpose | Allowed caller |
|---|---|---|
| `POST /api/documents/upload` | Upload document | Admin / Owner |
| `GET /api/documents` | List authorized documents | Authenticated users |
| `GET /api/documents/:id/download` | Download document | Authorized document user |
| `PATCH /api/documents/:id` | Update document | Admin / Owner / permitted editor |
| `DELETE /api/documents/:id/delete` | Delete document | Admin / Owner |
| `PUT /api/documents/:id/permissions/:userId` | Grant/update permission | Admin / Owner |
| `DELETE /api/documents/:id/permissions/:userId` | Revoke permission | Admin / Owner |
| `GET /api/admin/audit-logs` | View audit activity | Admin only |

The frontend is not considered an authorization boundary. Direct API requests are expected to receive the same authorization decisions as requests originating from the UI.

---

## Database Security

The application uses Supabase PostgreSQL Row Level Security (RLS).

Document access is protected through database policies in addition to application-level authorization.

The document policies enforce ownership and document-level access decisions.

Permission records are also protected so that unauthorized users cannot freely modify sharing relationships.

---

## Security Testing

Automated tests cover security-sensitive behavior including:

- authentication failures
- role authorization
- document ownership
- document permissions
- unauthorized document access
- download authorization
- update authorization
- deletion authorization
- permission management
- upload validation
- storage failure handling
- database failure handling
- audit logger validation

Run the test suite with:

```bash
npm test --silent
```

Run TypeScript validation with:

```bash
npx tsc --noEmit
```

The project was tested with the complete automated suite during development.

---

## Manual Security Verification

The deployed/application flows were also manually tested.

### Viewer cannot access an unshared document

A viewer attempting to download an unauthorized document received:

```text
404
{"error":"Document not found or access denied.","code":"not_found"}
```

### Read-only viewer cannot edit

A viewer with read permission but without edit permission attempted to update a document.

The UI returned:

```text
Forbidden: you do not have permission to edit this document.
```

### Viewer cannot delete

A viewer attempted to delete a readable document.

The UI returned:

```text
Forbidden: you do not have permission to delete this document.
```

The document remained available.

### Permission revocation

The following sequence was verified:

```text
Owner grants read permission
        ↓
Viewer sees document
        ↓
Viewer downloads document
        ↓
Owner revokes permission
        ↓
Viewer no longer sees document
        ↓
Direct download returns 404
```

### Admin audit access

An owner attempted to access:

```text
/api/admin/audit-logs
```

The server returned:

```text
403
{"error":"Admin access required."}
```

---

## Threat Model

See [`THREATS.md`](./THREATS.md) for the detailed threat model, mitigations, accepted risks, security testing strategy, and manual verification results.

---

## AI Development Log

AI assistance was used throughout development.

The development decisions, review findings, corrections, and related commits are documented in [`PROMPTS.md`](./PROMPTS.md).

The log includes security-focused AI requests covering:

- authentication
- role resolution
- document authorization
- upload validation
- threat modeling
- audit logging
- permission management
- security testing

---

## Project Structure

```text
trustvault/
├── app/
│   ├── api/
│   │   ├── admin/
│   │   └── documents/
│   ├── dashboard/
│   ├── login/
│   └── page.tsx
├── lib/
│   ├── auth/
│   ├── audit/
│   └── supabase/
├── scripts/
├── supabase/
│   └── migrations/
├── tests/
├── PROMPTS.md
├── THREATS.md
├── package.json
└── README.md
```

---

## Local Setup

### 1. Clone the repository

```bash
git clone https://github.com/keerthijavvaji24/trustvault.git
cd trustvault
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
AUDIT_SERVER_TOKEN=your_server_only_audit_token
```

The audit token must remain server-side and must never be exposed through client-side code or committed to Git.

### 4. Configure Supabase

The project uses:

- Supabase Auth
- PostgreSQL
- Row Level Security
- Supabase Storage
- private document storage
- audit logging database functions

Apply the SQL migrations in:

```text
supabase/migrations/
```

The migrations contain the database security configuration used by the project.

### 5. Start development server

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

---

## Test Roles

The application uses three roles:
### Demo Credentials

Use these dedicated demo accounts to test the deployed application:

| Role | Email | Password |
|---|---|---|
| Admin | `trustvault.admin.test@gmail.com` | `Tvault#Admin2026!X7` |
| Owner | `trustvault.owner.test@gmail.com` | `TvOwner@2026!Secure` |
| Viewer | `trustvault.viewer.test@gmail.com` | `TvViewer@2026!Secure` |

These accounts are provided for challenge evaluation only and contain demo data.

### Suggested Evaluation Flow

1. Sign in as **Owner** and upload a document.
2. Grant the **Viewer** read access to that document.
3. Sign in as **Viewer** and verify the document can be viewed/downloaded.
4. Verify the Viewer cannot edit or delete the document.
5. Sign in as **Owner** and revoke the Viewer's access.
6. Sign in as **Viewer** again and verify the document is no longer accessible.
7. Sign in as **Admin** and open **Admin Activity** to review allowed and denied audit events.

### Admin

Can:

- access all authorized documents
- manage documents
- manage permissions
- view audit activity

### Owner

Can:

- upload documents
- manage documents they own
- grant/update/revoke document permissions
- download their documents

### Viewer

Can:

- access explicitly shared documents
- download documents when granted read access
- edit only when explicitly granted edit access

Viewers cannot:

- upload documents
- delete documents
- grant permissions
- revoke permissions
- access the admin audit dashboard

Test account credentials should be provided separately during the challenge submission/demo rather than committed to this repository.

---

## Deployment

The application is designed for deployment on Vercel.

Required production environment variables:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
AUDIT_SERVER_TOKEN
```

After configuring the environment variables, deploy the Next.js application and verify the production URL.

Production verification should include:

1. Admin login
2. Owner login
3. Viewer login
4. Document upload
5. Document sharing
6. Viewer download
7. Permission revocation
8. Viewer access denial after revocation
9. Viewer edit denial without edit permission
10. Viewer delete denial
11. Admin audit activity
12. Direct API authorization checks

---

## Security Principles

TrustVault follows these principles:

1. **Never trust client-provided identity or ownership.**
2. **Authorize every protected operation on the server.**
3. **Check document permissions using current database state.**
4. **Keep documents in private storage.**
5. **Do not expose storage paths to clients unnecessarily.**
6. **Validate uploaded file content, not only MIME type.**
7. **Fail closed when authorization information is missing or invalid.**
8. **Record security-relevant document and permission activity.**
9. **Protect audit records from direct client modification.**
10. **Treat UI restrictions as convenience, not security controls.**

---

## Known Accepted Risks

See `THREATS.md` for the complete accepted-risk list.

Known limitations include operational concerns such as partial failure between Storage and database operations. These are documented rather than hidden.

---

## Challenge Submission

**Project:** TrustVault

**Repository:**  
`https://github.com/keerthijavvaji24/trustvault`

**Live URL:**  
_To be added after production deployment._

**Security documentation:**  
- `THREATS.md`
- `PROMPTS.md`

**Automated tests:**  
`npm test --silent`

**TypeScript validation:**  
`npx tsc --noEmit`