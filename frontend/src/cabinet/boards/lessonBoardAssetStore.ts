import { deleteInteractiveBoardAsset, uploadInteractiveBoardFile, uploadInteractiveBoardImage } from "../../utils/cabinetAuth";

const RASTER_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

function readDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
const ASSET_URL = /\/assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?/i;

/** SVG формулы остаются data URL: загрузчик доски SVG не принимает. */
export function lessonBoardAssetCanUpload(mime: string): boolean {
  return RASTER_MIME.has(String(mime || "").split(";", 1)[0].trim().toLowerCase())
    || String(mime || "").toLowerCase() === "application/pdf";
}

export function lessonBoardAssetSrc(src: unknown): string | null {
  const value = String(src || "").trim();
  if (!value) return null;
  return value;
}

export function lessonBoardAssetIdFromSrc(src: unknown): string {
  const match = ASSET_URL.exec(String(src || ""));
  return match ? match[1] : "";
}

type LessonRecord = {
  id?: string;
  typeName?: string;
  props?: { assetId?: string; src?: string };
};

/** Фигура ещё держит этот asset. Сама запись asset ссылкой не считается. */
export function lessonAssetIsReferenced(records: LessonRecord[], assetId: string): boolean {
  const id = String(assetId || "");
  if (!id) return false;
  return records.some((record) => record?.typeName === "shape" && record.props?.assetId === id);
}

type LessonAsset = {
  id?: string;
  props?: { name?: string; mimeType?: string; src?: string };
};

/**
 * Штатный TLAssetStore. В документ попадает постоянный URL доски,
 * а не blob: и не data URL растра.
 */
export function createLessonBoardAssetStore(boardId: string) {
  const id = String(boardId || "").trim();
  let bound = false;
  let records = (): LessonRecord[] => [];
  return {
    bind(editor: { store: { allRecords: () => LessonRecord[] } }) {
      bound = true;
      records = () => editor.store.allRecords();
    },
    async upload(asset: LessonAsset, file: File) {
      const mime = String(file.type || asset?.props?.mimeType || "").split(";", 1)[0].trim().toLowerCase();
      const body = new FormData();
      body.append("file", file, file.name || asset?.props?.name || "file");
      if (asset?.id) body.append("id", String(asset.id));
      try {
        const uploaded = RASTER_MIME.has(mime)
          ? await uploadInteractiveBoardImage(id, body)
          : await uploadInteractiveBoardFile(id, body);
        const src = lessonBoardAssetSrc(uploaded?.url || uploaded?.dataURL);
        if (!src) throw new Error("asset upload failed");
        return { src };
      } catch (error) {
        if (!RASTER_MIME.has(mime)) throw error;
        const src = await readDataUrl(file);
        if (!src) throw error;
        return { src };
      }
    },
    resolve(asset: LessonAsset) {
      return lessonBoardAssetSrc(asset?.props?.src);
    },
    async remove(assetIds: string[]) {
      if (!bound) return;
      const live = records();
      await Promise.all(assetIds.map(async (assetId) => {
        if (lessonAssetIsReferenced(live, assetId)) return;
        const asset = live.find((record) => record.id === assetId);
        const storedId = lessonBoardAssetIdFromSrc(asset?.props?.src);
        if (!storedId) return;
        try {
          await deleteInteractiveBoardAsset(id, storedId);
        } catch (error) {
          const status = (error as { status?: number })?.status;
          if (status === 409) return;
          throw error;
        }
      }));
    },
  };
}
