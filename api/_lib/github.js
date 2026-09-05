// Minimal GitHub Contents API client — just enough to read and write one
// file at a time in a repo, using the platform's built-in fetch (Node 18+,
// which is what Vercel's Node serverless runtime ships). No dependencies.

const API_BASE = "https://api.github.com";

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "bee4stitch-web-publish-machine",
  };
}

// Returns { content: string, sha: string } or null if the file doesn't exist yet.
async function getFile({ token, owner, repo, branch, path }) {
  const url = `${API_BASE}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, { headers: authHeaders(token) });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await safeJson(res);
    throw new Error(`GitHub GET ${path} failed: ${res.status} ${body && body.message ? body.message : res.statusText}`);
  }
  const body = await res.json();
  return { content: Buffer.from(body.content, "base64").toString("utf8"), sha: body.sha };
}

// Creates or updates a file. Pass `sha` (from a prior getFile) when updating
// an existing file — GitHub requires it to avoid clobbering a concurrent
// change; omit it to create a new file.
async function putFile({ token, owner, repo, branch, path, content, message, sha }) {
  const url = `${API_BASE}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) {
    const body = await safeJson(res);
    throw new Error(`GitHub PUT ${path} failed: ${res.status} ${body && body.message ? body.message : res.statusText}`);
  }
  return res.json();
}

async function safeJson(res) {
  try {
    return await res.json();
  } catch (e) {
    return null;
  }
}

module.exports = { getFile, putFile };
