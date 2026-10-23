# TrustVault Threat Model

## Purpose

TrustVault protects uploaded documents using server-side authentication,
authorization, private storage, database row-level security, file validation,
and audit logging.

The core security requirement is:

> A document must only be reachable by a user who is authorized to access it.

Authorization is checked server-side for every protected operation.

---

## Threats and Mitigations

### T1 — Unauthenticated access to documents

**Threat:**  
An unauthenticated user attempts to upload, read, modify, or delete documents.

**Mitigation:**  
Protected server routes verify the authenticated Supabase user before
performing document operations. Requests without a valid authenticated
session fail closed.

**Automated test:**  
Tests verify that unauthenticated document access is denied.

---

### T2 — Viewer uploads a document

**Threat:**  
A viewer attempts to upload a document despite not having an owner/admin
role.

**Mitigation:**  
The upload endpoint performs server-side role resolution and permits
uploads only for `admin` and `owner` roles.

**Automated test:**  
Upload tests verify that a viewer receives an authorization failure.

---

### T3 — Client-controlled document ownership

**Threat:**  
A malicious client submits another user's ID as `owner_id` during upload.

**Mitigation:**  
The server ignores client-supplied ownership and derives `owner_id` from
the verified authenticated user.

**Automated test:**  
Upload tests verify that a client cannot change document ownership.

---

### T4 — Client-controlled storage location

**Threat:**  
A malicious client supplies a storage path designed to overwrite or access
another user's storage area.

**Mitigation:**  
The server generates the storage path. The path begins with the verified
user ID and contains a server-generated UUID and sanitized filename.

**Automated test:**  
Upload tests verify that client-supplied `storage_path` values cannot
control the resulting storage location.

---

### T5 — Unauthorized document access

**Threat:**  
A user attempts to read another user's document without permission.

**Mitigation:**  
Document authorization is evaluated server-side. Admins have full access,
owners can access their own documents, and viewers require an explicit
document permission.

Database Row Level Security also protects the `documents` table.

**Automated test:**  
Document authorization tests verify owner, viewer, admin, unauthorized,
missing-profile, and invalid-role cases.

---

### T6 — Revoked access remains usable

**Threat:**  
A user's document permission is revoked, but previously granted access
continues to work.

**Mitigation:**  
Document authorization performs a fresh database permission lookup for each
protected access decision rather than relying on a long-lived authorization
cache.

**Accepted assumption:**  
A successfully completed request may already have returned data before
revocation. New protected requests must perform authorization again.

---

### T7 — Malicious file type spoofing

**Threat:**  
An attacker uploads a dangerous or incorrectly labeled file by changing
the filename or MIME type.

**Mitigation:**  
The upload endpoint uses an allowlist of supported MIME types and performs
server-side byte/signature validation before storing the file.

Supported formats currently include PDF, PNG, JPEG, DOCX, and plain text.

The maximum upload size is 10 MB.

**Automated test:**  
Upload tests verify valid signatures, mismatched MIME types, invalid file
content, supported MIME types, and the 10 MB boundary.

---

### T8 — Storage remains accessible after metadata failure

**Threat:**  
The storage upload succeeds but database metadata creation fails,
leaving an orphaned document object.

**Mitigation:**  
If database insertion fails after a successful storage upload, the server
attempts to remove the uploaded storage object before returning an error.

**Automated test:**  
Upload tests simulate database failure and verify that storage cleanup is
attempted.

---

### T9 — Public storage exposure

**Threat:**  
An attacker obtains a public URL to a stored document.

**Mitigation:**  
The Supabase `documents` storage bucket is private. The application does
not intentionally expose public document URLs.

Storage access is controlled by Storage RLS policies and document-level
authorization.

**Verification:**  
The deployed bucket configuration must remain private.

---

### T10 — Invalid or missing user profile

**Threat:**  
A valid authenticated account has no valid application profile or has an
unsupported role.

**Mitigation:**  
Server-side role resolution fails closed when the profile is missing or the
role is not one of the supported roles: `admin`, `owner`, or `viewer`.

**Automated test:**  
Authorization tests cover missing profiles and invalid roles.

---

## Security Design Principles

### Server-side authorization

The browser is never trusted to decide whether a user may access a
document. Authorization decisions are made on the server using the verified
Supabase identity and current database state.

### Fail closed

Missing authentication, missing profiles, invalid roles, missing documents,
and denied permissions result in rejection rather than fallback access.

### Least privilege

Viewers receive only explicitly granted document access. Owners receive
access to their own documents. Administrators have broader access because
they are responsible for administration.

### Immediate revocation

Document permissions are read from the database for each authorization
decision so that revocation takes effect for subsequent requests without
waiting for a client-side cache to expire.

---

## Accepted Risks

### A1 — Metadata and authorization complexity

The system currently relies on both application-level authorization and
Supabase Row Level Security. This creates additional implementation
complexity, but the duplication is intentional because authorization should
not depend on only one layer.

### A2 — File signature validation is format-focused

The upload validator verifies file signatures and basic content structure.
It does not fully parse every supported file format for all possible
malicious content.

### A3 — Denial-of-service through repeated uploads

The current implementation validates upload size and file type but does not
yet provide comprehensive rate limiting or abuse detection.

---

## Security Testing Strategy

The automated test suite currently covers:

- unauthenticated access denial
- role-based upload authorization
- missing profile handling
- invalid role handling
- ownership enforcement
- storage path generation
- client-controlled ownership rejection
- client-controlled storage path rejection
- missing files
- maximum upload size
- MIME allowlisting
- file signature validation
- storage failure handling
- database failure cleanup

Security tests should be expanded as additional document operations,
permissions, audit logging, and download endpoints are implemented.

---

## Future Security Checks

Before final submission, verify that:

1. Every document read/download endpoint performs authorization.
2. Every document edit endpoint performs authorization.
3. Every document delete endpoint performs authorization.
4. Permission grant/revoke operations are owner/admin controlled.
5. Denied access attempts are written to the audit trail.
6. Successful and failed downloads are audited.
7. Audit records cannot be silently modified by normal users.
8. Automated tests prove cross-user document isolation.
9. Revoked access immediately prevents subsequent access.
10. The deployed Supabase storage bucket remains private.