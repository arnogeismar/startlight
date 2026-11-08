import { Octokit } from '@octokit/rest';

export type RepoRef = {
  owner: string;
  repo: string;
};

export interface FileContent {
  text: string;
  sha: string;
}

export interface TreeFile {
  path: string;
  sha: string;
  size: number;
}

export function parseRepo(full: string): RepoRef | null {
  const cleaned = full
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  const m = cleaned.match(/^([A-Za-z0-9-_.]+)\/([A-Za-z0-9-_.]+)$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

export const repoKey = (r: RepoRef) => `${r.owner}/${r.repo}`.toLowerCase();

export function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function isNotFound(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { status?: number }).status === 404;
}

export function isConflict(e: unknown): boolean {
  const s = typeof e === 'object' && e !== null ? (e as { status?: number }).status : undefined;
  return s === 409 || s === 422;
}

const BRANCH_RE = /^(?!\/|.*\/\/|.*\.\.|.*@\{|.*\/$|.*\.lock$)[A-Za-z0-9._\-/]+$/;
export const isValidBranchName = (name: string) => BRANCH_RE.test(name) && !name.endsWith('.');

/** Thin wrapper around Octokit with the handful of operations the app needs. */
export class GitHub {
  readonly octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token, userAgent: 'contract-hub' });
  }

  async currentUser() {
    const { data } = await this.octokit.users.getAuthenticated();
    return { login: data.login, name: data.name ?? data.login, avatarUrl: data.avatar_url };
  }

  async getRepo(r: RepoRef) {
    const { data } = await this.octokit.repos.get(r);
    return {
      defaultBranch: data.default_branch,
      description: data.description ?? '',
      private: data.private,
      htmlUrl: data.html_url,
      canPush: Boolean(data.permissions?.push),
      canAdmin: Boolean(data.permissions?.admin),
    };
  }

  async readFile(r: RepoRef, path: string, ref?: string): Promise<FileContent | null> {
    try {
      const { data } = await this.octokit.repos.getContent({ ...r, path, ref });
      if (Array.isArray(data) || data.type !== 'file') throw new Error(`${path} is not a file`);
      // Files > 1MB come back without inline content; fetch the blob instead.
      if (!data.content && data.size > 0) {
        return { text: await this.readBlob(r, data.sha), sha: data.sha };
      }
      return { text: decodeBase64Utf8(data.content ?? ''), sha: data.sha };
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  async readBlob(r: RepoRef, sha: string): Promise<string> {
    const { data } = await this.octokit.git.getBlob({ ...r, file_sha: sha });
    return data.encoding === 'base64' ? decodeBase64Utf8(data.content) : data.content;
  }

  /** Create or update a file. Pass `sha` when updating; GitHub rejects stale shas with 409. */
  async writeFile(
    r: RepoRef,
    path: string,
    text: string,
    message: string,
    opts: { sha?: string; branch?: string } = {},
  ): Promise<{ sha: string; commitSha: string }> {
    const { data } = await this.octokit.repos.createOrUpdateFileContents({
      ...r,
      path,
      message,
      content: encodeBase64Utf8(text),
      sha: opts.sha,
      branch: opts.branch,
    });
    return { sha: data.content?.sha ?? '', commitSha: data.commit.sha ?? '' };
  }

  async listTree(r: RepoRef, ref: string): Promise<{ files: TreeFile[]; truncated: boolean; sha: string }> {
    const { data } = await this.octokit.git.getTree({ ...r, tree_sha: ref, recursive: 'true' });
    return {
      sha: data.sha,
      truncated: data.truncated,
      files: data.tree
        .filter((t) => t.type === 'blob' && t.path && t.sha)
        .map((t) => ({ path: t.path!, sha: t.sha!, size: t.size ?? 0 })),
    };
  }

  async listBranches(r: RepoRef): Promise<string[]> {
    const branches = await this.octokit.paginate(this.octokit.repos.listBranches, { ...r, per_page: 100 });
    return branches.map((b) => b.name);
  }

  async createBranch(r: RepoRef, name: string, fromBranch: string): Promise<void> {
    const { data } = await this.octokit.git.getRef({ ...r, ref: `heads/${fromBranch}` });
    await this.octokit.git.createRef({ ...r, ref: `refs/heads/${name}`, sha: data.object.sha });
  }

  async findOpenPullRequest(r: RepoRef, branch: string) {
    const { data } = await this.octokit.pulls.list({ ...r, head: `${r.owner}:${branch}`, state: 'open' });
    return data[0] ? { number: data[0].number, url: data[0].html_url, title: data[0].title } : null;
  }

  async listOpenPullRequests(r: RepoRef) {
    const { data } = await this.octokit.pulls.list({ ...r, state: 'open', per_page: 20 });
    return data.map((p) => ({
      number: p.number,
      title: p.title,
      url: p.html_url,
      branch: p.head.ref,
      author: p.user?.login ?? '',
      updatedAt: p.updated_at,
    }));
  }

  async createPullRequest(r: RepoRef, branch: string, base: string, title: string, body: string) {
    const { data } = await this.octokit.pulls.create({ ...r, head: branch, base, title, body });
    return { number: data.number, url: data.html_url };
  }

  async addCollaborator(r: RepoRef, username: string, permission: 'push' | 'pull' = 'push') {
    await this.octokit.repos.addCollaborator({ ...r, username, permission });
  }

  async userExists(login: string): Promise<boolean> {
    try {
      await this.octokit.users.getByUsername({ username: login });
      return true;
    } catch (e) {
      if (isNotFound(e)) return false;
      throw e;
    }
  }
}
