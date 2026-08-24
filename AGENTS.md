\# Checklist Project with Codex

\## Credentials

\- Never ask for or accept credentials in chat.

\- Approved encrypted credential file: "C:\\Users\\AdamCarbonell\\AppData\\Local\\stuff\\Codex\\ITGlue\\credentials.env".

\- Read the file as data; never execute or shell-source it.

\- Never display, log, copy, edit, or add credential values to output.

\- Stop and recommend rotation if exposure is possible.

\## Requests

\- Read-only requests are the default.

\- Before every request, preview the endpoint, method, filters, fields, result limit, data sensitivity, and possible side effects.

\- Never create, update, or delete data without separate authorization.

\- Never expand scope without new approval.

\## Results

\- Use narrow filters, explicit fields, and at most 1000 records.

\- Exclude secrets and unnecessary sensitive or free-text data.

\- Return a sanitized summary; do not save raw responses without approval.

\- State what the result can and cannot prove.




<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
