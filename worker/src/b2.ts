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

async function ensureAuth(): Promise<void> {
  if (authorized) return;
  await getClient().authorize();
  authorized = true;
}

export async function downloadFileById(fileId: string): Promise<Buffer> {
  await ensureAuth();
  const resp = await getClient().downloadFileById({
    fileId,
    responseType: "arraybuffer",
  });
  return Buffer.from(resp.data as ArrayBuffer);
}

export async function uploadFile(
  bucketId: string,
  fileName: string,
  data: Buffer,
  mime?: string,
): Promise<{ fileId: string; fileName: string }> {
  await ensureAuth();
  const { data: uploadData } = await getClient().getUploadUrl({ bucketId });
  const resp = await getClient().uploadFile({
    uploadUrl: uploadData.uploadUrl as string,
    uploadAuthToken: uploadData.authorizationToken as string,
    fileName,
    data,
    mime: mime ?? "b2/x-auto",
  });
  return { fileId: resp.data.fileId as string, fileName: resp.data.fileName as string };
}
