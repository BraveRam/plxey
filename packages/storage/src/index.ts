import B2 from "backblaze-b2";

let client: InstanceType<typeof B2> | null = null;

function getClient(): InstanceType<typeof B2> {
  if (!client) {
    client = new B2({
      applicationKeyId: process.env.B2_APPLICATION_KEY_ID!,
      applicationKey: process.env.B2_APPLICATION_KEY!,
    });
  }
  return client;
}

let authorized = false;

async function ensureAuth(force = false): Promise<void> {
  if (authorized && !force) return;
  await getClient().authorize();
  authorized = true;
}

// B2 authorization tokens (and per-operation upload tokens) expire after
// ~24h. The client caches the account auth, so once it goes stale every
// call fails with HTTP 401 `expired_auth_token` until the process
// restarts. Detect that, re-authorize, and retry the operation once.
function isExpiredAuth(err: unknown): boolean {
  const e = err as {
    response?: { status?: number; data?: { code?: string } };
  };
  const status = e?.response?.status;
  const code = e?.response?.data?.code;
  return (
    status === 401 ||
    code === "expired_auth_token" ||
    code === "bad_auth_token" ||
    code === "unauthorized"
  );
}

async function withAuthRetry<T>(op: () => Promise<T>): Promise<T> {
  await ensureAuth();
  try {
    return await op();
  } catch (err) {
    if (!isExpiredAuth(err)) throw err;
    // Force a fresh account authorization, then retry once.
    await ensureAuth(true);
    return op();
  }
}

export async function uploadFile(
  bucketId: string,
  fileName: string,
  data: Buffer,
  mime?: string,
): Promise<{ fileId: string; fileName: string }> {
  // getUploadUrl returns a short-lived upload token, so it must be re-run
  // (not just account re-auth) on the retry — both calls live inside the
  // same retried op.
  const resp = await withAuthRetry(async () => {
    const { data: uploadData } = await getClient().getUploadUrl({ bucketId });
    return getClient().uploadFile({
      uploadUrl: uploadData.uploadUrl as string,
      uploadAuthToken: uploadData.authorizationToken as string,
      fileName,
      data,
      mime: mime ?? "b2/x-auto",
    });
  });
  return {
    fileId: resp.data.fileId as string,
    fileName: resp.data.fileName as string,
  };
}

export async function downloadFileById(fileId: string): Promise<Uint8Array> {
  const resp = await withAuthRetry(() =>
    getClient().downloadFileById({ fileId, responseType: "arraybuffer" }),
  );
  return new Uint8Array(resp.data as ArrayBuffer);
}

export async function deleteFile(
  bucketId: string,
  fileId: string,
  fileName: string,
): Promise<void> {
  await withAuthRetry(() =>
    getClient().deleteFileVersion({ fileId, fileName }),
  );
}

export function b2BucketId(): string {
  const id = process.env.B2_BUCKET_ID;
  if (!id) throw new Error("B2_BUCKET_ID not configured");
  return id;
}
