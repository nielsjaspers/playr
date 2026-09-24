import type { ICloudAudioFile } from '../modules/playr-icloud';

type PreparationOptions = {
  verify: (id: string) => Promise<ICloudAudioFile | null>;
  request: (id: string) => Promise<void>;
  wait?: () => Promise<void>;
};

/** Downloads and prefetches share one observation loop per file. */
export function createFilePreparation({ verify, request, wait = () => new Promise<void>((resolve) => setTimeout(resolve, 1_000)) }: PreparationOptions) {
  const pending = new Map<string, Promise<ICloudAudioFile>>();
  async function prepare(id: string) {
    let file = await verify(id);
    if (!file) throw new Error('This file is no longer in the Playr iCloud folder.');
    if (file.downloadState === 'downloaded' && file.localUri) return file;
    if (file.downloadState === 'inCloud') await request(id);
    for (let attempt = 0; attempt < 180; attempt += 1) {
      await wait();
      file = await verify(id);
      if (file?.downloadState === 'downloaded' && file.localUri) return file;
    }
    throw new Error('The iCloud download is taking longer than expected. You can retry; the transfer may continue in the background.');
  }
  return (id: string) => {
    const existing = pending.get(id);
    if (existing) return existing;
    const result = prepare(id).finally(() => pending.delete(id));
    pending.set(id, result);
    return result;
  };
}
