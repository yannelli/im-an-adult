import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  chromeWebStoreUrls,
  normalizePublishType,
  publishChromeWebStore,
  requireChromeWebStoreCredentials,
  versionFromReleaseTag,
} from "../scripts/publish-chrome-web-store.mjs";

const root = join(import.meta.dir, "..");

const CREDENTIALS = {
  CHROME_EXTENSION_ID: "abcdefghijklmnopabcdefghijklmnop",
  CHROME_PUBLISHER_ID: "publisher-123",
  CHROME_CLIENT_ID: "client.apps.googleusercontent.com",
  CHROME_CLIENT_SECRET: "client-secret",
  CHROME_REFRESH_TOKEN: "refresh-token",
};

function writeZipWithManifest(version) {
  const dir = mkdtempSync(join(tmpdir(), "im-an-adult-cws-"));
  const zipPath = join(dir, `im-an-adult-${version}.zip`);
  const script = `
import json, sys, zipfile
path, version = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(path, "w") as zf:
    zf.writestr("manifest.json", json.dumps({"manifest_version": 3, "version": version}))
`;
  const result = spawnSync("python3", ["-c", script, zipPath, version], { encoding: "utf8" });
  expect(result.status).toBe(0);
  return zipPath;
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

function mockFetch(queue) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const next = queue.shift();
    if (!next) throw new Error(`Unexpected fetch: ${url}`);
    return typeof next === "function" ? next(url, init) : next;
  };
  return { fetchImpl, calls };
}

describe("requireChromeWebStoreCredentials", () => {
  test("requires the Chrome Web Store API secrets", () => {
    expect(() => requireChromeWebStoreCredentials({})).toThrow(/CHROME_EXTENSION_ID/);
    expect(() => requireChromeWebStoreCredentials({ ...CREDENTIALS, CHROME_REFRESH_TOKEN: "  " })).toThrow(
      /CHROME_REFRESH_TOKEN/,
    );
    expect(() =>
      requireChromeWebStoreCredentials({ ...CREDENTIALS, CHROME_EXTENSION_ID: "not-an-id" }),
    ).toThrow(/32-character/);
  });

  test("returns trimmed credentials for a valid environment", () => {
    expect(requireChromeWebStoreCredentials({ ...CREDENTIALS, CHROME_PUBLISHER_ID: "  publisher-123  " })).toEqual({
      extensionId: CREDENTIALS.CHROME_EXTENSION_ID,
      publisherId: "publisher-123",
      clientId: CREDENTIALS.CHROME_CLIENT_ID,
      clientSecret: CREDENTIALS.CHROME_CLIENT_SECRET,
      refreshToken: CREDENTIALS.CHROME_REFRESH_TOKEN,
    });
  });
});

describe("chromeWebStoreUrls", () => {
  test("uses the Chrome Web Store v2 endpoints", () => {
    expect(chromeWebStoreUrls("publisher-123", "abcdefghijklmnopabcdefghijklmnop")).toEqual({
      token: "https://oauth2.googleapis.com/token",
      upload:
        "https://chromewebstore.googleapis.com/upload/v2/publishers/publisher-123/items/abcdefghijklmnopabcdefghijklmnop:upload",
      publish:
        "https://chromewebstore.googleapis.com/v2/publishers/publisher-123/items/abcdefghijklmnopabcdefghijklmnop:publish",
      status:
        "https://chromewebstore.googleapis.com/v2/publishers/publisher-123/items/abcdefghijklmnopabcdefghijklmnop:fetchStatus",
    });
  });
});

describe("versionFromReleaseTag", () => {
  test("accepts semver tags and rejects other releases", () => {
    expect(versionFromReleaseTag("v1.2.3")).toBe("1.2.3");
    expect(() => versionFromReleaseTag("v1.2.3-beta.1")).toThrow(/semver/i);
    expect(() => versionFromReleaseTag("1.2.3")).toThrow(/semver/i);
  });
});

describe("normalizePublishType", () => {
  test("maps store targets to the v2 publishType values", () => {
    expect(normalizePublishType()).toBe("DEFAULT_PUBLISH");
    expect(normalizePublishType("default")).toBe("DEFAULT_PUBLISH");
    expect(normalizePublishType("trustedTesters")).toBe("TRUSTED_TESTERS");
    expect(normalizePublishType("STAGED_PUBLISH")).toBe("STAGED_PUBLISH");
    expect(() => normalizePublishType("public")).toThrow(/publish/i);
  });
});

describe("publishChromeWebStore", () => {
  test("refreshes a token, uploads the release zip, then publishes", async () => {
    const zipPath = writeZipWithManifest("0.2.0");
    const { fetchImpl, calls } = mockFetch([
      jsonResponse(200, { access_token: "ya29.access" }),
      jsonResponse(200, { uploadState: "SUCCEEDED", crxVersion: "0.2.0", itemId: CREDENTIALS.CHROME_EXTENSION_ID }),
      jsonResponse(200, { state: "PENDING_REVIEW", itemId: CREDENTIALS.CHROME_EXTENSION_ID }),
    ]);

    const result = await publishChromeWebStore({
      env: CREDENTIALS,
      zipPath,
      tag: "v0.2.0",
      fetchImpl,
    });

    expect(result.action).toBe("published");
    expect(result.upload.uploadState).toBe("SUCCEEDED");
    expect(result.publish.state).toBe("PENDING_REVIEW");

    expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(calls[0].init.body).toContain("grant_type=refresh_token");
    expect(calls[0].init.body).toContain("refresh_token=refresh-token");

    expect(calls[1].url).toContain(":upload");
    expect(calls[1].init.method).toBe("POST");
    expect(calls[1].init.headers.Authorization).toBe("Bearer ya29.access");
    expect(calls[1].init.headers["X-Goog-Upload-Protocol"]).toBe("raw");
    expect(calls[1].init.body.byteLength).toBeGreaterThan(0);

    expect(calls[2].url).toContain(":publish");
    expect(JSON.parse(calls[2].init.body)).toEqual({ publishType: "DEFAULT_PUBLISH" });
  });

  test("polls fetchStatus when the upload is still in progress", async () => {
    const zipPath = writeZipWithManifest("0.2.0");
    let slept = 0;
    const { fetchImpl } = mockFetch([
      jsonResponse(200, { access_token: "ya29.access" }),
      jsonResponse(200, { uploadState: "IN_PROGRESS" }),
      jsonResponse(200, { lastAsyncUploadState: "SUCCEEDED", itemId: CREDENTIALS.CHROME_EXTENSION_ID }),
      jsonResponse(200, { state: "PUBLISHED", itemId: CREDENTIALS.CHROME_EXTENSION_ID }),
    ]);

    const result = await publishChromeWebStore({
      env: CREDENTIALS,
      zipPath,
      fetchImpl,
      sleep: async (ms) => {
        slept += ms;
      },
    });

    expect(result.action).toBe("published");
    expect(slept).toBeGreaterThan(0);
  });

  test("does not publish when the zip version does not match the release tag", async () => {
    const zipPath = writeZipWithManifest("0.1.0");
    const { fetchImpl, calls } = mockFetch([]);

    await expect(
      publishChromeWebStore({
        env: CREDENTIALS,
        zipPath,
        tag: "v0.2.0",
        fetchImpl,
      }),
    ).rejects.toThrow(/0\.1\.0/);
    expect(calls).toEqual([]);
  });

  test("does not publish after a failed upload", async () => {
    const zipPath = writeZipWithManifest("0.2.0");
    const { fetchImpl, calls } = mockFetch([
      jsonResponse(200, { access_token: "ya29.access" }),
      jsonResponse(200, { uploadState: "FAILED" }),
    ]);

    await expect(
      publishChromeWebStore({
        env: CREDENTIALS,
        zipPath,
        fetchImpl,
      }),
    ).rejects.toThrow(/upload/i);
    expect(calls).toHaveLength(2);
  });

  test("surfaces token and API errors", async () => {
    const zipPath = writeZipWithManifest("0.2.0");
    await expect(
      publishChromeWebStore({
        env: CREDENTIALS,
        zipPath,
        fetchImpl: async () => jsonResponse(400, { error: { message: "invalid_grant" } }),
      }),
    ).rejects.toThrow(/invalid_grant/);
  });

  test("skips non-semver GitHub releases", async () => {
    const result = await publishChromeWebStore({
      env: CREDENTIALS,
      zipPath: writeZipWithManifest("0.2.0"),
      tag: "nightly",
      fetchImpl: async () => {
        throw new Error("should not call the store API");
      },
    });
    expect(result).toEqual({ action: "skip" });
  });
});

describe("publish CLI", () => {
  test("fails when credentials or a zip are missing", () => {
    const missingZip = spawnSync("bun", [join(root, "scripts", "publish-chrome-web-store.mjs")], {
      encoding: "utf8",
      env: { ...process.env, ...CREDENTIALS, CHROME_ZIP_PATH: "" },
    });
    expect(missingZip.status).toBe(1);
    expect(missingZip.stderr).toMatch(/zip/i);

    const zipPath = writeZipWithManifest("0.1.0");
    const missingSecret = spawnSync("bun", [join(root, "scripts", "publish-chrome-web-store.mjs"), "--zip", zipPath], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        CHROME_ZIP_PATH: zipPath,
      },
    });
    expect(missingSecret.status).toBe(1);
    expect(missingSecret.stderr).toMatch(/CHROME_EXTENSION_ID/);
    expect(missingSecret.stderr).toMatch(/CONTRIBUTING\.md/);
  });
});

describe("chrome web store workflow", () => {
  test("publishes after a GitHub Release and can be retried by tag", () => {
    const workflow = spawnSync("cat", [join(root, ".github/workflows/chrome-web-store.yml")], { encoding: "utf8" });
    expect(workflow.status).toBe(0);
    expect(workflow.stdout).toMatch(/release:\s*\n\s*types:\s*\n\s*-\s*published/m);
    expect(workflow.stdout).toContain("workflow_dispatch");
    expect(workflow.stdout).toContain("im-an-adult-*.zip");
    expect(workflow.stdout).toContain("publish-chrome-web-store.mjs");
    expect(workflow.stdout).toContain("CHROME_EXTENSION_ID");
    expect(workflow.stdout).toContain("CHROME_PUBLISHER_ID");
    expect(workflow.stdout).toContain("CHROME_CLIENT_ID");
    expect(workflow.stdout).toContain("CHROME_CLIENT_SECRET");
    expect(workflow.stdout).toContain("CHROME_REFRESH_TOKEN");
    expect(workflow.stdout).not.toMatch(/prerelease: true/);
  });
});
