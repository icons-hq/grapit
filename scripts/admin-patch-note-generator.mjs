import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = path.join(
  repoRoot,
  'apps/web/content/admin-patch-notes.generated.json',
);

const sectionHeadings = {
  summary: '패치노트 요약',
  highlights: '패치노트 하이라이트',
  evidence: '패치노트 검증',
};

export function buildAdminPatchNote(pullRequest) {
  const summary = parseSummarySection(
    extractSection(pullRequest.body ?? '', sectionHeadings.summary),
  );
  const highlights = parseListSection(
    extractSection(pullRequest.body ?? '', sectionHeadings.highlights),
  );
  const evidence = parseListSection(
    extractSection(pullRequest.body ?? '', sectionHeadings.evidence),
  );

  if (!summary || highlights.length === 0 || evidence.length === 0) {
    return null;
  }

  const title = normalizeTitle(pullRequest.title);

  return {
    id: `pr-${pullRequest.number}-${slugify(title)}`,
    prNumber: pullRequest.number,
    title,
    summary,
    highlights,
    category: inferCategory(pullRequest),
    date: (pullRequest.merged_at ?? new Date().toISOString()).slice(0, 10),
    githubUrl: pullRequest.html_url,
    evidence,
  };
}

export function mergeAdminPatchNote(notes, nextNote) {
  return [...notes.filter((note) => note.prNumber !== nextNote.prNumber), nextNote].sort(
    comparePatchNotes,
  );
}

export async function generateAdminPatchNote({
  githubToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN,
  repository = process.env.GITHUB_REPOSITORY,
  deployedSha = process.env.DEPLOYED_SHA,
  notesPath = catalogPath,
} = {}) {
  if (!githubToken) {
    throw new Error('GITHUB_TOKEN or GH_TOKEN is required');
  }
  if (!repository) {
    throw new Error('GITHUB_REPOSITORY is required');
  }
  if (!deployedSha) {
    throw new Error('DEPLOYED_SHA is required');
  }

  const pullRequest = await findPullRequestForCommit({
    githubToken,
    repository,
    deployedSha,
  });

  if (!pullRequest) {
    console.log(`No merged pull request is associated with ${deployedSha}.`);
    return false;
  }

  const note = buildAdminPatchNote(pullRequest);

  if (!note) {
    console.log(`PR #${pullRequest.number} has no complete admin patch note sections.`);
    return false;
  }

  const currentNotes = JSON.parse(await readFile(notesPath, 'utf8'));
  const nextNotes = mergeAdminPatchNote(currentNotes, note);
  const nextSource = `${JSON.stringify(nextNotes, null, 2)}\n`;
  const currentSource = await readFile(notesPath, 'utf8');

  if (currentSource === nextSource) {
    console.log(`Admin patch note for PR #${pullRequest.number} is already current.`);
    return false;
  }

  await writeFile(notesPath, nextSource);
  console.log(`Registered admin patch note for PR #${pullRequest.number}.`);
  return true;
}

async function findPullRequestForCommit({ githubToken, repository, deployedSha }) {
  const associatedPulls = await githubJson({
    githubToken,
    repository,
    path: `/commits/${deployedSha}/pulls`,
  });
  const pull = associatedPulls.find((entry) => entry.merged_at);

  if (!pull) {
    return null;
  }

  return githubJson({
    githubToken,
    repository,
    path: `/pulls/${pull.number}`,
  });
}

async function githubJson({ githubToken, repository, path: requestPath }) {
  const response = await fetch(
    `https://api.github.com/repos/${repository}${requestPath}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${githubToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );

  if (!response.ok) {
    throw new Error(`GitHub API ${requestPath} failed with ${response.status}`);
  }

  return response.json();
}

function extractSection(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const startIndex = lines.findIndex((line) =>
    new RegExp(`^#{2,6}\\s+${escapeRegExp(heading)}\\s*$`).test(line.trim()),
  );

  if (startIndex === -1) {
    return '';
  }

  const sectionLines = [];

  for (const line of lines.slice(startIndex + 1)) {
    if (/^#{2,6}\s+\S/.test(line.trim())) {
      break;
    }
    sectionLines.push(line);
  }

  return sectionLines.join('\n');
}

function parseSummarySection(section) {
  const lines = section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('-'))
    .filter((line) => !isPlaceholder(line));

  return lines.join(' ').trim();
}

function parseListSection(section) {
  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+(?:\[[ xX]\]\s*)?/, '').trim())
    .filter((line) => line && !isPlaceholder(line));
}

function normalizeTitle(title) {
  return title
    .replace(/^(?:feat|fix|chore|docs|test|refactor|perf|ci|build|style)(?:\([^)]+\))?:\s*/i, '')
    .trim();
}

function inferCategory(pullRequest) {
  const labels = new Set(
    (pullRequest.labels ?? []).map((label) => label.name.toLowerCase()),
  );
  const rawTitle = pullRequest.title.toLowerCase();

  if (
    labels.has('ops') ||
    labels.has('infra') ||
    labels.has('deploy') ||
    labels.has('ci') ||
    rawTitle.startsWith('ops:') ||
    rawTitle.startsWith('ci:')
  ) {
    return 'ops';
  }

  if (
    labels.has('bug') ||
    labels.has('fix') ||
    labels.has('patch') ||
    rawTitle.startsWith('fix:')
  ) {
    return 'patch';
  }

  return 'feature';
}

function slugify(value) {
  const slug = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'admin-patch-note';
}

function comparePatchNotes(a, b) {
  const byDate = b.date.localeCompare(a.date);

  if (byDate !== 0) {
    return byDate;
  }

  return b.prNumber - a.prNumber;
}

function isPlaceholder(value) {
  return /^(?:-|tbd|todo|n\/a|없음)$/i.test(value.trim());
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateAdminPatchNote().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
