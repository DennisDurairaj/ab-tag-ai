import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";

const ABS_IMAGE = "ghcr.io/advplyr/audiobookshelf:latest";
const CONTAINER_NAME = "abs-e2e-test";
const ABS_ADMIN_USER = "admin";
const ABS_ADMIN_PASSWORD = "e2e-test-pw-abc123xyz";

function findFreePort(): number {
  const server = createServer();
  server.listen(0);
  const port = (server.address() as AddressInfo).port;
  server.close();
  return port;
}

export interface AbsTestEnv {
  url: string;
  apiToken: string;
  libraryId: string;
  configDir: string;
  mediaDir: string;
}

async function fetchWithRetry(url: string, options?: RequestInit, retries = 3): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw lastError;
}

async function waitForStatus(url: string, timeoutMs = 120000): Promise<void> {
  const statusUrl = url.replace(/\/$/, "") + "/status";
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetchWithRetry(statusUrl);
      if (resp.ok) return;
    } catch {
      // container not ready yet
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`ABS container did not respond to /status within ${timeoutMs}ms`);
}

function isContainerRunning(name: string): boolean {
  try {
    const result = execSync(`docker ps -a -q -f name=${name}`, { encoding: "utf-8" });
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

function isContainerActive(name: string): boolean {
  try {
    const result = execSync(`docker ps -q -f name=${name}`, { encoding: "utf-8" });
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

function removeContainerIfExists(name: string): void {
  if (isContainerRunning(name)) {
    try {
      execSync(`docker rm -f ${name}`, { stdio: "pipe" });
    } catch {
      // ignore
    }
  }
}

function runDocker(cmd: string): void {
  execSync(cmd, { stdio: "inherit" });
}

function runDockerSilent(cmd: string): string {
  return execSync(cmd, { encoding: "utf-8", stdio: "pipe" }).trim();
}

export async function startAbsContainer(): Promise<AbsTestEnv> {
  removeContainerIfExists(CONTAINER_NAME);

  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "abs-e2e-config-"));
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), "abs-e2e-media-"));
  const port = findFreePort();

  console.log(`Pulling ABS Docker image...`);
  runDocker(`docker pull ${ABS_IMAGE}`);

  console.log(`Starting ABS container on port ${port}...`);
  const containerId = runDockerSilent(
    `docker run -d --name ${CONTAINER_NAME} ` +
      `-v ${configDir}:/config ` +
      `-v ${mediaDir}:/audiobooks ` +
      `-p ${port}:80 ` +
      `${ABS_IMAGE}`,
  );
  console.log(`  Container: ${containerId.slice(0, 12)}`);

  const absUrl = `http://localhost:${port}`;

  console.log("Waiting for ABS to be ready...");
  await waitForStatus(absUrl, 120000);

  // Additional wait for full initialization (db migrations, etc.)
  await new Promise((r) => setTimeout(r, 5000));

  // Initialize root user via POST /init with { newRoot: { username, password } }
  console.log("Initializing ABS root user...");
  const initResp = await fetchWithRetry(`${absUrl}/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      newRoot: {
        username: ABS_ADMIN_USER,
        password: ABS_ADMIN_PASSWORD,
      },
    }),
  });

  if (!initResp.ok) {
    const text = await initResp.text();
    throw new Error(`Failed to init ABS root user: ${initResp.status} ${text}`);
  }

  // Login to get API token
  console.log("Logging in to get API token...");
  const loginResp = await fetchWithRetry(`${absUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: ABS_ADMIN_USER, password: ABS_ADMIN_PASSWORD }),
  });

  if (!loginResp.ok) {
    const text = await loginResp.text();
    throw new Error(`Login failed: ${loginResp.status} ${text}`);
  }

  const loginData = (await loginResp.json()) as { user: { token: string } };
  const apiToken = loginData.user.token;

  // Create a test library
  console.log("Creating test library...");
  const createResp = await fetchWithRetry(`${absUrl}/api/libraries`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiToken}`,
    },
    body: JSON.stringify({
      name: "E2E Test Library",
      folders: [{ fullPath: "/audiobooks" }],
    }),
  });

  if (!createResp.ok) {
    const text = await createResp.text();
    throw new Error(`Failed to create library: ${createResp.status} ${text}`);
  }

  const libData = (await createResp.json()) as { id: string };

  console.log(`ABS ready: url=${absUrl} library=${libData.id}`);
  return {
    url: absUrl,
    apiToken,
    libraryId: libData.id,
    configDir,
    mediaDir,
  };
}

export function stopAbsContainer(): void {
  console.log("Stopping ABS container...");
  try {
    execSync(`docker stop -t 5 ${CONTAINER_NAME}`, { stdio: "pipe" });
  } catch {
    // ignore stop errors
  }
  try {
    execSync(`docker rm -f ${CONTAINER_NAME}`, { stdio: "pipe" });
  } catch {
    // ignore rm errors
  }
  console.log("  Container removed.");
}

export function isAbsContainerAlive(): boolean {
  return isContainerActive(CONTAINER_NAME);
}

export async function killAbsContainer(): Promise<void> {
  console.log("Killing ABS container for fallback test...");
  try {
    execSync(`docker kill ${CONTAINER_NAME}`, { stdio: "pipe" });
  } catch {
    // ignore
  }
}
