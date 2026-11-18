export const profileImageAccept = "image/png,image/jpeg,image/webp,image/gif";

export const profileImageFormatLabel = "PNG・JPEG・WebP・GIF";

// D1 limits a single text value or row to 2,000,000 bytes. Keep room for the
// other profile fields stored in the same row when persisting a data URL.
export const profileImageMaxStoredUrlLength = 1_850_000;
// Source files may be larger because they are cropped and compressed before storage.
export const profileImageMaxUploadBytes = 10_000_000;

const profileImageMimeTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export const isProfileImageMimeType = (value: string) =>
  profileImageMimeTypes.has(value.trim().toLowerCase());

export const isProfileImageDataUrl = (value: string) =>
  /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(value);

export const detectProfileImageMimeType = (bytes: Uint8Array) => {
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return "";
};
