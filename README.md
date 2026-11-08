# Contract Hub

A static web app for browsing and editing the **OpenAPI** and **AsyncAPI** contracts in your GitHub
repositories, built so that analysts and other less technical people can change contracts through forms
instead of hand-editing JSON/YAML.

**There is no backend.** The app runs entirely in the browser and talks directly to the GitHub API.
All application state (tracked projects, admins, edit rights) lives in a single JSON file in a GitHub
repository, so every change to it is a reviewable commit.

## Features

- **Projects**: admins add GitHub repositories (`owner/name` or a URL). The repo is scanned for
  OpenAPI (3.x and Swagger 2.0) and AsyncAPI (2.x and 3.x) files, in JSON or YAML.
- **Project overview**: every contract in the repo, with its REST endpoints grouped by tag
  (method, path, summary) and its AsyncAPI operations (send/receive, channel, messages). Searchable,
  switchable per branch, plus a list of open pull requests.
- **Feature-branch editing**: editing always happens on a feature branch, never on the default branch.
  Clicking *Edit* asks you to create a branch (`feature/…`) or reuse an existing one.
- **Visual contract editor**:
  - OpenAPI: general info, servers, tags; endpoints (method, path, parameters, request body,
    responses); reusable data models.
  - AsyncAPI: channels, operations (v3) or publish/subscribe (v2), messages and payloads, data models.
  - A schema editor with plain-language types ("Text", "Whole number", "List", "Object (fields)", …),
    required flags, formats, allowed values, nested objects and lists, and references to shared models.
  - Renaming a model, message, channel or operation updates every `$ref` that points to it.
  - Live validation (missing titles, broken `$ref`s, duplicate operationIds, undeclared path
    parameters, …), undo/redo, and local autosave of unsaved work.
  - *Raw file* tab for power users, plus a JSON fallback for exotic schema constructs.
- **Review & save**: shows a plain-language summary ("Added endpoint POST /orders", "Changed schema
  Order") and a line diff, then commits to the branch. YAML files are patched in place, so comments
  and formatting of untouched parts are kept and PR diffs stay small.
- **Request review**: opens a pull request with a change summary against the default branch.
- **Permissions**: everyone can read; admins can give edit rights per repository, and optionally invite
  the person as a GitHub collaborator with write access in the same step.

## Setup

1. **Create a state repository**, e.g. `my-org/contract-hub-state` (private is fine). It only holds
   `contract-hub.json`.
2. **Deploy the app.** Push this repo to GitHub and enable *Settings → Pages → Source: GitHub Actions*.
   The workflow in `.github/workflows/deploy.yml` builds and publishes it. Optionally set a repository
   variable `STATE_REPO` so the sign-in screen is prefilled. (Any static host works: `npm run build`
   and serve `dist/`.)
3. **Sign in** with a GitHub personal access token. A fine-grained token needs, on the state repo and the
   repos you work with: *Contents* read/write, *Pull requests* read/write, *Metadata* read
   (*Administration* write only if admins want to invite collaborators from the app). Read-only users
   only need read access. The token is stored in the browser's `localStorage` and only sent to
   `api.github.com`.
4. The first person to sign in with write access to the state repo clicks **Initialize workspace** and
   becomes the first admin.

## Security model (important)

Without a backend, the app cannot enforce permissions on its own. GitHub does the real enforcement:

| Action | Enforced by |
| --- | --- |
| Read a project or contract | GitHub read access to that repo |
| Change projects, admins or editors | **Write access to the state repo.** Restrict this to admins (use branch protection / CODEOWNERS on `contract-hub.json` if needed). |
| Edit contracts (branches, commits, PRs) | GitHub write access to the target repo. The app's editor list controls who sees edit controls; the *Also grant write access on GitHub* checkbox keeps the two in sync. |
| Merge to the default branch | The repo's normal pull request review and branch protection |

In short, the app's roles give people a clear workflow, and GitHub permissions plus branch protection
are the hard guarantee. Someone with GitHub write access could bypass the app and push directly, the
same as today. Protect your default branches so every contract change goes through a reviewed PR.

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (parsing, extraction, validation, ref renames, permissions, YAML preservation)
npm run typecheck
npm run build

# End-to-end smoke test against a faked GitHub API (no real GitHub calls)
npm run build && (npx vite preview --port 4173 &) && npm run e2e
```

### Code map

| Path | What |
| --- | --- |
| `src/lib/github.ts` | GitHub API wrapper (files, trees, branches, PRs, collaborators) |
| `src/lib/state.ts` | `contract-hub.json` model, permission checks, optimistic-locking updates |
| `src/lib/scan.ts` | Finds contracts in a repo tree |
| `src/lib/contracts.ts` | Parse/serialize (format-preserving), endpoint/operation extraction, validation |
| `src/lib/docEdit.ts` | Editing helpers: ordered renames, `$ref` rewriting, schema kinds, change summaries |
| `src/pages/` | Projects, project overview, editor, admin, sign-in |
| `src/components/editor/` | Form editors for endpoints, schemas, channels, operations, messages |

### State file format

```json
{
  "schemaVersion": 1,
  "admins": ["alice"],
  "projects": [
    {
      "owner": "acme", "repo": "orders",
      "addedBy": "alice", "addedAt": "2026-11-07T10:00:00.000Z",
      "editors": ["bob"],
      "lastScan": { "at": "…", "branch": "main", "treeSha": "…", "contracts": [ { "path": "api/openapi.yaml", "kind": "openapi", "specVersion": "3.0.3", "title": "Orders API", "version": "1.0.0" } ] }
    }
  ]
}
```

### Known limitations

- Sign-in uses a personal access token. GitHub's OAuth web flow needs a server-side secret exchange;
  if you want "Sign in with GitHub", add a tiny token-exchange function (e.g. a Cloudflare Worker) and
  swap it in for the token form.
- Scanning reads every candidate `.json`/`.yaml` file (tooling files and `node_modules` etc. are
  skipped). In very large repos only files whose path hints at an API spec are scanned.
- Only local `$ref`s (`#/…`) are resolved; references to other files are shown but not followed.
- Swagger 2.0 body parameters, multiple media types per body, and shared parameters/responses are
  read-only in the forms; edit them in the *Raw file* tab.
