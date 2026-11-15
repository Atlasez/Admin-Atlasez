export const profileImageAccept = "image/png,image/jpeg,image/webp,image/gif";

export const profileImageFormatLabel = "PNG・JPEG・WebP・GIF";

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
