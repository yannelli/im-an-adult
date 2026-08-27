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
const PUBLISH_TYPES = {
  "": "DEFAULT_PUBLISH",
  default: "DEFAULT_PUBLISH",
  DEFAULT_PUBLISH: "DEFAULT_PUBLISH",
  trustedTesters: "TRUSTED_TESTERS",
  TRUSTED_TESTERS: "TRUSTED_TESTERS",
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
        Authorization: `Bearer ${accessToken}`,
        "X-Goog-Upload-Protocol": "raw",
        "X-Goog-Upload-File-Name": "extension.zip",
      },
      body: zip,
    }),
    "Chrome Web Store upload failed",
  );

  let waited = 0;
  while (uploaded.uploadState === "IN_PROGRESS") {
    if (waited >= maxWaitMs) throw new Error("Chrome Web Store upload stayed in progress too long.");
    await sleep(intervalMs);
    waited += intervalMs;
    const status = await readJson(
      await fetchImpl(urls.status, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
      "Chrome Web Store status check failed",
    );
    uploaded.uploadState = status.lastAsyncUploadState;
  }

  if (uploaded.uploadState !== "SUCCEEDED") {
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
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ publishType }),
    }),
    "Chrome Web Store publish failed",
  );
  if (published.state && !PUBLISH_OK.has(published.state)) {
    throw new Error(`Chrome Web Store publish failed: ${published.state}`);
  }
  return published;
}

function argValue(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
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
  if (tag && !SEMVER_TAG.test(tag)) {
    console.log(`Not a semver release tag (${tag}); skipping Chrome Web Store publish.`);
    return { action: "skip" };
  }

  if (!zipPath) throw new Error("A release zip is required. Pass --zip or set CHROME_ZIP_PATH.");
  if (!existsSync(zipPath)) throw new Error(`Zip not found: ${zipPath}`);

  if (tag) {
    const version = versionFromReleaseTag(tag);
    const zipVersion = readManifestVersion(zipPath);
    if (zipVersion !== version) {
      throw new Error(`Zip manifest version ${zipVersion} does not match release ${tag}`);
    }
  }

  const credentials = requireChromeWebStoreCredentials(env);
  const accessToken = await fetchAccessToken({ ...credentials, fetchImpl });
  const upload = await uploadPackage({
    ...credentials,
    accessToken,
    zip: readFile(zipPath),
    fetchImpl,
    sleep,
  });
  const publish = await publishItem({
    ...credentials,
    accessToken,
    fetchImpl,
    publishType: normalizePublishType(env.CHROME_PUBLISH_TARGET),
  });

  const label = tag || upload.crxVersion || "extension";
  console.log(`Published ${label} to the Chrome Web Store (${publish.state ?? "submitted"}).`);
  return { action: "published", upload, publish };
}

if (import.meta.main) {
  publishChromeWebStore().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
