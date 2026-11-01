import { describe, it, expect, vi, beforeEach } from "vitest";

const execFile = vi.fn();
vi.mock("node:child_process", () => ({ execFile }));

const { resolveCredential } = await import("./credentials.js");
const { SpaceshipClient } = await import("./spaceship-client.js");

const opReturns = (stdout: string) =>
  execFile.mockImplementationOnce((_cmd, _args, _opts, cb) => cb(null, { stdout, stderr: "" }));
const opFails = (message: string) =>
  execFile.mockImplementationOnce((_cmd, _args, _opts, cb) => cb(new Error(message)));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);
const listResponse = () =>
  new Response(JSON.stringify({ items: [], total: 0 }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("resolveCredential", () => {
  beforeEach(() => {
    execFile.mockReset();
    mockFetch.mockReset();
  });

  it("returns plain values without calling op", async () => {
    expect(await resolveCredential("plain-key")).toBe("plain-key");
    expect(execFile).not.toHaveBeenCalled();
  });

  it("reads op:// references through the 1Password CLI", async () => {
    opReturns("resolved-secret");
    expect(await resolveCredential("op://Private/spaceship-api/credential")).toBe("resolved-secret");
    expect(execFile.mock.calls[0][0]).toBe("op");
    expect(execFile.mock.calls[0][1]).toEqual(["read", "--no-newline", "op://Private/spaceship-api/credential"]);
  });

  it("hides op error output", async () => {
    opFails("item 'spaceship-api' not found in vault Private");
    await expect(resolveCredential("op://Private/spaceship-api/username")).rejects.toThrow(
      /^Could not read Spaceship credentials from 1Password/,
    );
  });

  it("client resolves once, sends resolved headers, and retries after a failed unlock", async () => {
    const client = new SpaceshipClient("op://v/i/username", "op://v/i/credential", "https://api.test.com", 0);

    opFails("locked");
    opReturns("k");
    await expect(client.listDnsRecords("example.com", { take: 1, skip: 0 })).rejects.toThrow(/1Password/);
    expect(mockFetch).not.toHaveBeenCalled();

    opReturns("key");
    opReturns("secret");
    mockFetch.mockResolvedValueOnce(listResponse()).mockResolvedValueOnce(listResponse());
    await client.listDnsRecords("example.com", { take: 1, skip: 0 });
    await client.listDnsRecords("example.com", { take: 1, skip: 0 });

    expect(execFile).toHaveBeenCalledTimes(4);
    const headers = mockFetch.mock.calls[1][1].headers as Headers;
    expect(headers.get("X-API-Key")).toBe("key");
    expect(headers.get("X-API-Secret")).toBe("secret");
  });
});
