import type { GitHub, RepoRef, TreeFile } from './github';
import { looksLikeContract, parseContract, type Doc } from './contracts';
import type { ContractSummary } from './state';

export interface ScannedContract extends ContractSummary {
  doc: Doc;
}

export const toSummary = ({ doc: _doc, ...summary }: ScannedContract): ContractSummary => summary;

const IGNORED_DIRS = /(^|\/)(node_modules|vendor|dist|build|target|bin|obj|out|coverage|\.git|\.idea|\.vscode|\.next|\.nuxt|bower_components|__pycache__)\//;
const IGNORED_FILES = /(^|\/)(package(-lock)?\.json|composer\.(json|lock)|tsconfig[^/]*\.json|jsconfig\.json|\.eslintrc[^/]*|\.prettierrc[^/]*|renovate\.json|lerna\.json|nx\.json|turbo\.json|angular\.json|project\.json|pnpm-lock\.yaml|yarn\.lock|docker-compose[^/]*\.ya?ml|\.gitlab-ci\.yml|mkdocs\.yml|pubspec\.yaml|Chart\.yaml|values[^/]*\.ya?ml|launchSettings\.json|appsettings[^/]*\.json)$/i;
const LIKELY_NAME = /(openapi|swagger|asyncapi|api|spec|contract|schema|events?)/i;

export const MAX_FILE_SIZE = 5 * 1024 * 1024;
export const MAX_CANDIDATES = 200;

/** Picks which files in the tree are worth downloading to check for contracts. */
export function candidateFiles(files: TreeFile[]): TreeFile[] {
  const all = files.filter(
    (f) => /\.(json|ya?ml)$/i.test(f.path) && !IGNORED_DIRS.test(f.path) && !IGNORED_FILES.test(f.path) && f.size <= MAX_FILE_SIZE,
  );
  if (all.length <= MAX_CANDIDATES) return all;
  // Large repos: prefer files whose name or folder hints at an API description.
  const likely = all.filter((f) => LIKELY_NAME.test(f.path));
  return likely.slice(0, MAX_CANDIDATES);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export interface ScanResult {
  branch: string;
  treeSha: string;
  contracts: ScannedContract[];
  truncated: boolean;
  skipped: number;
}

export async function scanRepository(gh: GitHub, r: RepoRef, branch: string): Promise<ScanResult> {
  const tree = await gh.listTree(r, branch);
  const relevant = tree.files.filter((f) => /\.(json|ya?ml)$/i.test(f.path));
  const candidates = candidateFiles(tree.files);
  const found = await mapLimit(candidates, 8, async (f): Promise<ScannedContract | null> => {
    try {
      const text = await gh.readBlob(r, f.sha);
      if (!looksLikeContract(text)) return null;
      const parsed = parseContract(text, f.path);
      return {
        path: f.path,
        kind: parsed.kind,
        specVersion: parsed.specVersion,
        title: String(parsed.doc.info?.title ?? f.path),
        version: String(parsed.doc.info?.version ?? ''),
        doc: parsed.doc,
      };
    } catch {
      return null; // unparsable or not a contract
    }
  });
  return {
    branch,
    treeSha: tree.sha,
    contracts: found.filter((c): c is ScannedContract => c !== null).sort((a, b) => a.path.localeCompare(b.path)),
    truncated: tree.truncated,
    skipped: Math.max(0, relevant.length - candidates.length),
  };
}

/** Scans are relatively expensive (one request per candidate file); keep results for the session. */
export const scanCache = new Map<string, ScanResult>();
export const scanCacheKey = (r: RepoRef, branch: string) => `${r.owner}/${r.repo}@${branch}`.toLowerCase();
