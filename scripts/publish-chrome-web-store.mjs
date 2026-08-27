import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const REQUIRED_SECRETS = [
  "CHROME_EXTENSION_ID",
  "CHROME_PUBLISHER_ID",
  "CHROME_CLIENT_ID",
  "CHROME_CLIENT_SECRET",
  "CHROME_REFRESH_TOKEN",
];
const EXTENSION_ID = /^[a-p]{32}$/;
const SEMVER_TAG = /^v(\d+\.\d+\.\d+)$/;
const PUBLISH_OK = new Set(["PENDING_REVIEW", "STAGED", "PUBLISHED", "PUBLISHED_TO_TESTERS"]);
const UPLOAD_IN_PROGRESS = new Set(["IN_PROGRESS", "UPLOAD_IN_PROGRESS"]);
const UPLOAD_SUCCEEDED = new Set(["SUCCEEDED", "SUCCESS", "UPLOAD_SUCCESS"]);
const PUBLISH_TYPES = {
  "": "DEFAULT_PUBLISH",
  default: "DEFAULT_PUBLISH",
  DEFAULT_PUBLISH: "DEFAULT_PUBLISH",
  staged: "STAGED_PUBLISH",
  STAGED_PUBLISH: "STAGED_PUBLISH",
};

export function requireChromeWebStoreCredentials(env = process.env) {
  const missing = REQUIRED_SECRETS.filter((name) => !env[name]?.trim());
  if (missing.length) {
    throw new Error(
      `Missing ${missing.join(", ")}. Add these repository secrets so SemVer releases can publish to the Chrome Web Store. See CONTRIBUTING.md.`,
    );
  }

  const extensionId = env.CHROME_EXTENSION_ID.trim();
  if (!EXTENSION_ID.test(extensionId)) {
    throw new Error(
      "CHROME_EXTENSION_ID must be the 32-character item ID from the Chrome Web Store dashboard.",
    );
  }

  return {
    extensionId,
    publisherId: env.CHROME_PUBLISHER_ID.trim(),
    clientId: env.CHROME_CLIENT_ID.trim(),
    clientSecret: env.CHROME_CLIENT_SECRET.trim(),
    refreshToken: env.CHROME_REFRESH_TOKEN.trim(),
  };
}

export function chromeWebStoreUrls(publisherId, extensionId) {
  const item = `publishers/${publisherId}/items/${extensionId}`;
  return {
    token: "https://oauth2.googleapis.com/token",
    upload: `https://chromewebstore.googleapis.com/upload/v2/${item}:upload`,
    publish: `https://chromewebstore.googleapis.com/v2/${item}:publish`,
    status: `https://chromewebstore.googleapis.com/v2/${item}:fetchStatus`,
  };
}

export function versionFromReleaseTag(tag) {
  const match = SEMVER_TAG.exec(tag ?? "");
  if (!match) throw new Error(`Not a semver release tag: ${tag}`);
  return match[1];
}

export function normalizePublishType(target) {
  const mapped = PUBLISH_TYPES[target?.trim() ?? ""];
  if (!mapped) throw new Error(`Unknown Chrome Web Store publish target: ${target}`);
  return mapped;
}

export function revisionCrxVersions(revision) {
  if (!revision) return [];
  const versions = [];
  if (revision.crxVersion) versions.push(revision.crxVersion);
  for (const channel of revision.distributionChannels ?? []) {
    if (channel.crxVersion) versions.push(channel.crxVersion);
  }
  return versions;
}

export function matchingStoreRevision(status, version) {
  const submitted = status?.submittedItemRevisionStatus;
  if (revisionCrxVersions(submitted).includes(version)) return submitted;
  const published = status?.publishedItemRevisionStatus;
  if (revisionCrxVersions(published).includes(version)) return published;
  return null;
}

export function isSameVersionUploadError(message) {
  const text = String(message ?? "");
  if (/too low|must be (increased|higher|greater)|higher than|greater than/i.test(text)) return false;
  return /version/i.test(text) && /already|same|exists|uploaded|duplicate/i.test(text);
}

export function readManifestVersionFromZip(zipPath) {
  const script = `
import json, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as zf:
    print(json.loads(zf.read("manifest.json"))["version"])
`;
  const result = spawnSync("python3", ["-c", script, zipPath], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `Failed to read manifest.json from ${zipPath}`);
  }
  return result.stdout.trim();
}

function googleError(body) {
  if (typeof body?.error === "string") return body.error_description || body.error;
  if (body?.error?.message) return body.error.message;
  return "";
}

async function readJson(response, fallback) {
  const body = await response.json().catch(() => ({}));
  const message = googleError(body);
  if (!response.ok) throw new Error(message || `${fallback} (HTTP ${response.status})`);
  if (body.error) throw new Error(message || fallback);
  return body;
}

function authHeaders(accessToken) {
  return { Authorization: `Bearer ${accessToken}` };
}

export async function fetchAccessToken({ clientId, clientSecret, refreshToken, fetchImpl = fetch }) {
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  const body = await readJson(response, "Failed to refresh the Chrome Web Store access token");
  if (!body.access_token) throw new Error("Chrome Web Store token response did not include access_token");
  return body.access_token;
}

export async function fetchItemStatus({ accessToken, publisherId, extensionId, fetchImpl = fetch }) {
  const urls = chromeWebStoreUrls(publisherId, extensionId);
  return readJson(
    await fetchImpl(urls.status, { method: "GET", headers: authHeaders(accessToken) }),
    "Chrome Web Store status check failed",
  );
}

export async function uploadPackage({
  accessToken,
  publisherId,
  extensionId,
  zip,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  intervalMs = 2000,
  maxWaitMs = 60_000,
}) {
  const urls = chromeWebStoreUrls(publisherId, extensionId);
  const uploaded = await readJson(
    await fetchImpl(urls.upload, {
      method: "POST",
      headers: {
        ...authHeaders(accessToken),
        "X-Goog-Upload-Protocol": "raw",
        "X-Goog-Upload-File-Name": "extension.zip",
      },
      body: zip,
    }),
    "Chrome Web Store upload failed",
  );

  let waited = 0;
  while (UPLOAD_IN_PROGRESS.has(uploaded.uploadState)) {
    if (waited >= maxWaitMs) throw new Error("Chrome Web Store upload stayed in progress too long.");
    await sleep(intervalMs);
    waited += intervalMs;
    const status = await fetchItemStatus({ accessToken, publisherId, extensionId, fetchImpl });
    uploaded.uploadState = status.lastAsyncUploadState;
  }

  if (!UPLOAD_SUCCEEDED.has(uploaded.uploadState)) {
    throw new Error(`Chrome Web Store upload failed: ${uploaded.uploadState}`);
  }
  return uploaded;
}

export async function publishItem({
  accessToken,
  publisherId,
  extensionId,
  publishType = "DEFAULT_PUBLISH",
  fetchImpl = fetch,
}) {
  const urls = chromeWebStoreUrls(publisherId, extensionId);
  const published = await readJson(
    await fetchImpl(urls.publish, {
      method: "POST",
      headers: {
        ...authHeaders(accessToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ publishType }),
    }),
    "Chrome Web Store publish failed",
  );
  if (!PUBLISH_OK.has(published.state)) {
    throw new Error(`Chrome Web Store publish failed: ${published.state ?? "missing state"}`);
  }
  return published;
}

function argValue(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

function resolveReleaseTag(tag) {
  if (!tag) return null;
  if (SEMVER_TAG.test(tag)) return tag;
  return { invalid: tag };
}

export async function publishChromeWebStore({
  env = process.env,
  zipPath = argValue(process.argv, "--zip") || env.CHROME_ZIP_PATH,
  tag = argValue(process.argv, "--tag") || env.RELEASE_TAG,
  fetchImpl = fetch,
  sleep,
  readFile = readFileSync,
  readManifestVersion = readManifestVersionFromZip,
} = {}) {
  const resolvedTag = resolveReleaseTag(tag);
  if (resolvedTag?.invalid) {
    if (env.GITHUB_EVENT_NAME === "workflow_dispatch") {
      throw new Error(`Not a semver release tag: ${resolvedTag.invalid}`);
    }
    console.log(`Not a semver release tag (${resolvedTag.invalid}); skipping Chrome Web Store publish.`);
    return { action: "skip" };
  }

  if (!zipPath) throw new Error("A release zip is required. Pass --zip or set CHROME_ZIP_PATH.");
  if (!existsSync(zipPath)) throw new Error(`Zip not found: ${zipPath}`);

  const zipVersion = readManifestVersion(zipPath);
  const version = resolvedTag ? versionFromReleaseTag(resolvedTag) : zipVersion;
  if (resolvedTag && zipVersion !== version) {
    throw new Error(`Zip manifest version ${zipVersion} does not match release ${resolvedTag}`);
  }

  const credentials = requireChromeWebStoreCredentials(env);
  const accessToken = await fetchAccessToken({ ...credentials, fetchImpl });
  const status = await fetchItemStatus({ ...credentials, accessToken, fetchImpl });
  const existing = matchingStoreRevision(status, version);
  if (existing && PUBLISH_OK.has(existing.state)) {
    console.log(`v${version} is already on the Chrome Web Store (${existing.state}).`);
    return { action: "published", alreadyPresent: true, publish: existing };
  }

  let upload;
  try {
    upload = await uploadPackage({
      ...credentials,
      accessToken,
      zip: readFile(zipPath),
      fetchImpl,
      sleep,
    });
  } catch (error) {
    if (!isSameVersionUploadError(error.message)) throw error;
    console.log(`Upload rejected (${error.message}); publishing the existing store draft.`);
    upload = { uploadState: "SUCCEEDED", reused: true };
  }

  const publish = await publishItem({
    ...credentials,
    accessToken,
    fetchImpl,
    publishType: normalizePublishType(env.CHROME_PUBLISH_TARGET),
  });

  const label = resolvedTag || `v${version}`;
  console.log(`Published ${label} to the Chrome Web Store (${publish.state}).`);
  return { action: "published", upload, publish };
}

if (import.meta.main) {
  publishChromeWebStore().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
