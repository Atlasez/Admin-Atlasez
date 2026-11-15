import type { ParsedFrame, ParsedGif } from "gifuct-js";
import {
  detectProfileImageMimeType,
  isProfileImageMimeType,
  profileImageMaxStoredUrlLength,
  profileImageMaxUploadBytes,
} from "../lib/profile-image";

type CroppedProfileImageDetail = {
  avatarUrl: string;
  fileName: string;
  originalBytes: number;
};

type GifImageFrame = {
  image: ImageData;
  delay: number;
};

const MAX_STATIC_IMAGE_PIXELS = 30_000_000;
const MAX_GIF_FRAMES = 600;
// 1280×1280, 12 frames (the supplied GIF) uses about 19.7M source pixels.
// Cropped output is downscaled to at most 320×320 before it is stored.
const MAX_GIF_TOTAL_PIXELS = 24_000_000;
const GIF_PREVIEW_SIZE = 320;

const formatSize = (bytes: number) => {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1_000))}KB`;
  return `${(bytes / 1_000_000).toFixed(1)}MB`;
};

const yieldToBrowser = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const toDataUrl = (mimeType: string, bytes: Uint8Array) => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
};

const frameDelay = (frame: ParsedFrame) =>
  Math.max(
    20,
    Number.isFinite(frame.delay) && frame.delay > 0 ? frame.delay : 100,
  );

const makeCanvas = (width: number, height: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context)
    throw new Error("画像を調整できませんでした。別の画像を選択してください。");
  return { canvas, context };
};

const cropBox = (
  width: number,
  height: number,
  side: number,
  fitScale: number,
  zoom: number,
  offsetX: number,
  offsetY: number,
) => {
  const scale = fitScale * zoom;
  const sourceSide = Math.min(side / scale, width, height);
  const centerX = width / 2 - offsetX / scale;
  const centerY = height / 2 - offsetY / scale;
  return {
    x: clamp(centerX - sourceSide / 2, 0, width - sourceSide),
    y: clamp(centerY - sourceSide / 2, 0, height - sourceSide),
    side: sourceSide,
  };
};

const makeStaticAvatar = (
  image: HTMLImageElement,
  box: { x: number; y: number; side: number },
) => {
  for (const outputSize of [320, 256]) {
    const { canvas, context } = makeCanvas(outputSize, outputSize);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      box.x,
      box.y,
      box.side,
      box.side,
      0,
      0,
      outputSize,
      outputSize,
    );
    for (const quality of [0.9, 0.78, 0.66]) {
      const dataUrl = canvas.toDataURL("image/webp", quality);
      if (dataUrl.length <= profileImageMaxStoredUrlLength) return dataUrl;
    }
  }
  throw new Error(
    "切り抜き後の画像が大きすぎます。別の画像を選択してください。",
  );
};

const decodeGifFrames = async (
  parsedGif: ParsedGif,
  box: { x: number; y: number; side: number },
  onProgress: (message: string) => void,
) => {
  const { decompressFrames } = await import("gifuct-js");
  const frames = decompressFrames(parsedGif, true);
  if (!frames.length)
    throw new Error("GIFアニメーションを読み込めませんでした。");

  const sourceWidth = parsedGif.lsd.width;
  const sourceHeight = parsedGif.lsd.height;
  const { canvas: sourceCanvas, context: sourceContext } = makeCanvas(
    sourceWidth,
    sourceHeight,
  );
  const { context: avatarContext } = makeCanvas(
    GIF_PREVIEW_SIZE,
    GIF_PREVIEW_SIZE,
  );
  const { canvas: patchCanvas, context: patchContext } = makeCanvas(1, 1);
  const sampleEvery = Math.max(1, Math.ceil(frames.length / 60));
  const outputFrames: GifImageFrame[] = [];
  let previousFrame: ParsedFrame | null = null;
  let restoreBeforePrevious: ImageData | null = null;
  let accumulatedDelay = 0;

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    if (!frame) continue;

    if (previousFrame) {
      if (previousFrame.disposalType === 2) {
        sourceContext.clearRect(
          previousFrame.dims.left,
          previousFrame.dims.top,
          previousFrame.dims.width,
          previousFrame.dims.height,
        );
      } else if (previousFrame.disposalType === 3 && restoreBeforePrevious) {
        sourceContext.putImageData(restoreBeforePrevious, 0, 0);
      }
    }

    const restoreBeforeCurrent =
      frame.disposalType === 3
        ? sourceContext.getImageData(0, 0, sourceWidth, sourceHeight)
        : null;
    const patch = sourceContext.createImageData(
      frame.dims.width,
      frame.dims.height,
    );
    patch.data.set(frame.patch);
    patchCanvas.width = frame.dims.width;
    patchCanvas.height = frame.dims.height;
    patchContext.putImageData(patch, 0, 0);
    sourceContext.globalCompositeOperation = "source-over";
    sourceContext.drawImage(patchCanvas, frame.dims.left, frame.dims.top);

    accumulatedDelay += frameDelay(frame);
    const isSampleFrame =
      (index + 1) % sampleEvery === 0 || index === frames.length - 1;
    if (isSampleFrame) {
      avatarContext.clearRect(0, 0, GIF_PREVIEW_SIZE, GIF_PREVIEW_SIZE);
      avatarContext.drawImage(
        sourceCanvas,
        box.x,
        box.y,
        box.side,
        box.side,
        0,
        0,
        GIF_PREVIEW_SIZE,
        GIF_PREVIEW_SIZE,
      );
      outputFrames.push({
        image: avatarContext.getImageData(
          0,
          0,
          GIF_PREVIEW_SIZE,
          GIF_PREVIEW_SIZE,
        ),
        delay: Math.min(accumulatedDelay, 60_000),
      });
      accumulatedDelay = 0;
    }

    previousFrame = frame;
    restoreBeforePrevious = restoreBeforeCurrent;
    if (index % 12 === 11) {
      onProgress(`GIFアニメーションを調整中… ${index + 1}/${frames.length}`);
      await yieldToBrowser();
    }
  }
  return outputFrames;
};

const reduceGifFrames = (frames: GifImageFrame[], maxFrames: number) => {
  const groupSize = Math.max(1, Math.ceil(frames.length / maxFrames));
  const reduced: GifImageFrame[] = [];
  for (let start = 0; start < frames.length; start += groupSize) {
    const group = frames.slice(start, start + groupSize);
    const lastFrame = group.at(-1);
    if (!lastFrame) continue;
    reduced.push({
      image: lastFrame.image,
      delay: Math.min(
        group.reduce((total, frame) => total + frame.delay, 0),
        60_000,
      ),
    });
  }
  return reduced;
};

const encodeGifFrames = async (
  frames: GifImageFrame[],
  onProgress: (message: string) => void,
) => {
  const { GIFEncoder, applyPalette, quantize } = await import("gifenc");
  const presets = [
    { size: 320, frameCount: 60, colors: 96 },
    { size: 256, frameCount: 48, colors: 64 },
    { size: 224, frameCount: 36, colors: 48 },
    { size: 192, frameCount: 24, colors: 32 },
    { size: 160, frameCount: 18, colors: 24 },
  ];

  for (const [presetIndex, preset] of presets.entries()) {
    const sampledFrames = reduceGifFrames(frames, preset.frameCount);
    const encoder = GIFEncoder();
    const { canvas: sourceCanvas, context: sourceContext } = makeCanvas(
      GIF_PREVIEW_SIZE,
      GIF_PREVIEW_SIZE,
    );
    const { context: outputContext } = makeCanvas(preset.size, preset.size);

    for (let index = 0; index < sampledFrames.length; index += 1) {
      const frame = sampledFrames[index];
      if (!frame) continue;
      sourceContext.putImageData(frame.image, 0, 0);
      outputContext.clearRect(0, 0, preset.size, preset.size);
      outputContext.imageSmoothingEnabled = true;
      outputContext.imageSmoothingQuality = "high";
      outputContext.drawImage(
        sourceCanvas,
        0,
        0,
        GIF_PREVIEW_SIZE,
        GIF_PREVIEW_SIZE,
        0,
        0,
        preset.size,
        preset.size,
      );
      const rgba = outputContext.getImageData(
        0,
        0,
        preset.size,
        preset.size,
      ).data;
      const palette = quantize(rgba, preset.colors, {
        format: "rgba4444",
        oneBitAlpha: true,
      });
      const transparentIndex = palette.findIndex(
        (color) => (color[3] ?? 255) < 128,
      );
      const indexMap = applyPalette(rgba, palette, "rgba4444");
      encoder.writeFrame(indexMap, preset.size, preset.size, {
        delay: frame.delay,
        dispose: transparentIndex >= 0 ? 2 : 1,
        palette,
        repeat: 0,
        transparent: transparentIndex >= 0,
        transparentIndex,
      });
      if (index % 8 === 7) {
        onProgress(
          `GIFを保存サイズに調整中… ${index + 1}/${sampledFrames.length}`,
        );
        await yieldToBrowser();
      }
    }

    encoder.finish();
    const dataUrl = toDataUrl("image/gif", encoder.bytes());
    if (dataUrl.length <= profileImageMaxStoredUrlLength) return dataUrl;
    if (presetIndex < presets.length - 1) {
      onProgress("GIFの容量を小さくしています…");
      await yieldToBrowser();
    }
  }
  throw new Error(
    "このGIFは切り抜き後も容量が大きすぎます。短いGIFか、別の画像を選択してください。",
  );
};

const makeGifAvatar = async (
  parsedGif: ParsedGif,
  box: { x: number; y: number; side: number },
  onProgress: (message: string) => void,
) => {
  const frames = await decodeGifFrames(parsedGif, box, onProgress);
  return encodeGifFrames(frames, onProgress);
};

const openPicker = (root: HTMLElement) => {
  const input = root.querySelector<HTMLInputElement>(
    "[data-profile-image-input]",
  );
  const dialog = root.querySelector<HTMLDialogElement>(
    "[data-profile-image-crop-dialog]",
  );
  const viewport = root.querySelector<HTMLElement>("[data-crop-viewport]");
  const image = root.querySelector<HTMLImageElement>("[data-crop-source]");
  const fileLabel = root.querySelector<HTMLElement>(
    "[data-profile-image-file-label]",
  );
  const status = root.querySelector<HTMLOutputElement>(
    "[data-profile-image-status]",
  );
  const cropMessage = root.querySelector<HTMLOutputElement>(
    "[data-crop-message]",
  );
  const zoomInput = root.querySelector<HTMLInputElement>("[data-crop-zoom]");
  const applyButton =
    root.querySelector<HTMLButtonElement>("[data-crop-apply]");
  if (
    !input ||
    !dialog ||
    !viewport ||
    !image ||
    !fileLabel ||
    !status ||
    !cropMessage ||
    !zoomInput ||
    !applyButton
  )
    return;

  let file: File | null = null;
  let mimeType = "";
  let parsedGif: ParsedGif | null = null;
  let objectUrl = "";
  let fitScale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let zoom = 1;
  let draggingPointer: number | null = null;
  let lastPointer = { x: 0, y: 0 };
  let geometryReady = false;
  let applied = false;

  const setStatus = (
    message: string,
    state: "idle" | "working" | "selected" | "saved" | "error" = "idle",
  ) => {
    status.value = message;
    status.dataset.state = state;
  };

  const clearPreview = () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = "";
    image.removeAttribute("src");
    geometryReady = false;
    file = null;
    parsedGif = null;
  };

  const updateImageTransform = () => {
    if (!geometryReady) return;
    const side = viewport.getBoundingClientRect().width;
    const scale = fitScale * zoom;
    const overflowX = Math.max(0, (image.naturalWidth * scale - side) / 2);
    const overflowY = Math.max(0, (image.naturalHeight * scale - side) / 2);
    offsetX = clamp(offsetX, -overflowX, overflowX);
    offsetY = clamp(offsetY, -overflowY, overflowY);
    image.style.width = `${image.naturalWidth * fitScale}px`;
    image.style.height = `${image.naturalHeight * fitScale}px`;
    image.style.left = `calc(50% + ${offsetX}px)`;
    image.style.top = `calc(50% + ${offsetY}px)`;
    image.style.transform = `translate(-50%, -50%) scale(${zoom})`;
  };

  const closeCropDialog = () => {
    if (dialog.open) dialog.close();
  };

  input.addEventListener("change", async () => {
    const selectedFile = input.files?.[0];
    input.value = "";
    if (!selectedFile) return;
    clearPreview();
    applied = false;
    setStatus("画像を確認中…", "working");
    applyButton.disabled = true;

    if (selectedFile.size > profileImageMaxUploadBytes) {
      setStatus(
        `画像は${formatSize(profileImageMaxUploadBytes)}以下にしてください。`,
        "error",
      );
      return;
    }

    try {
      const headerBytes = new Uint8Array(
        await selectedFile.slice(0, 12).arrayBuffer(),
      );
      mimeType = detectProfileImageMimeType(headerBytes);
      if (!mimeType || !isProfileImageMimeType(mimeType)) {
        throw new Error(
          "PNG・JPEG・WebP・GIFの画像ファイルを選択してください。",
        );
      }

      objectUrl = URL.createObjectURL(selectedFile);
      image.src = objectUrl;
      await image.decode();
      if (!image.naturalWidth || !image.naturalHeight) {
        throw new Error(
          "画像を読み込めませんでした。別の画像を選択してください。",
        );
      }
      if (image.naturalWidth * image.naturalHeight > MAX_STATIC_IMAGE_PIXELS) {
        throw new Error(
          "画像のサイズが大きすぎます。小さくしてから選択してください。",
        );
      }

      if (mimeType === "image/gif") {
        const { parseGIF } = await import("gifuct-js");
        parsedGif = parseGIF(await selectedFile.arrayBuffer());
        const frameCount = parsedGif.frames.filter(
          (frame) => "image" in frame,
        ).length;
        if (!frameCount || frameCount > MAX_GIF_FRAMES) {
          throw new Error(
            "GIFのフレーム数が多すぎます。短いアニメーションを選択してください。",
          );
        }
        if (
          parsedGif.lsd.width * parsedGif.lsd.height * frameCount >
          MAX_GIF_TOTAL_PIXELS
        ) {
          throw new Error(
            "GIFのサイズまたはフレーム数が大きすぎます。短いアニメーションを選択してください。",
          );
        }
      }

      file = selectedFile;
      fileLabel.textContent = `${selectedFile.name} · ${formatSize(selectedFile.size)} · ${mimeType === "image/gif" ? "アニメーションを保持" : "画像を切り抜き"}`;
      if (!dialog.open) dialog.showModal();
      const viewportSize = viewport.getBoundingClientRect().width;
      if (!viewportSize) {
        throw new Error(
          "画像の調整画面を開けませんでした。再度お試しください。",
        );
      }
      fitScale =
        viewportSize / Math.min(image.naturalWidth, image.naturalHeight);
      offsetX = 0;
      offsetY = 0;
      zoom = 1;
      zoomInput.value = "1";
      geometryReady = true;
      updateImageTransform();
      applyButton.disabled = false;
      cropMessage.value =
        "ドラッグして位置を調整できます。拡大・縮小はスライダーで変更します。";
      setStatus(
        `${selectedFile.name}（${formatSize(selectedFile.size)}）を選択中です。表示範囲を調整してください。`,
        "selected",
      );
    } catch (error) {
      if (dialog.open) dialog.close();
      clearPreview();
      setStatus(
        error instanceof Error ? error.message : "画像を読み込めませんでした。",
        "error",
      );
    }
  });

  zoomInput.addEventListener("input", () => {
    zoom = Number(zoomInput.value) || 1;
    updateImageTransform();
  });

  viewport.addEventListener("pointerdown", (event) => {
    if (!geometryReady) return;
    draggingPointer = event.pointerId;
    lastPointer = { x: event.clientX, y: event.clientY };
    viewport.dataset.dragging = "true";
    viewport.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener("pointermove", (event) => {
    if (draggingPointer !== event.pointerId) return;
    offsetX += event.clientX - lastPointer.x;
    offsetY += event.clientY - lastPointer.y;
    lastPointer = { x: event.clientX, y: event.clientY };
    updateImageTransform();
  });
  const stopDragging = (event: PointerEvent) => {
    if (draggingPointer !== event.pointerId) return;
    draggingPointer = null;
    delete viewport.dataset.dragging;
  };
  viewport.addEventListener("pointerup", stopDragging);
  viewport.addEventListener("pointercancel", stopDragging);

  root
    .querySelectorAll<HTMLButtonElement>("[data-crop-cancel]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        closeCropDialog();
        if (!applied) setStatus("画像の調整を取り消しました。", "idle");
        clearPreview();
      });
    });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      closeCropDialog();
      clearPreview();
      setStatus("画像の調整を取り消しました。", "idle");
    }
  });

  dialog.addEventListener("cancel", () => {
    clearPreview();
    setStatus("画像の調整を取り消しました。", "idle");
  });

  root.addEventListener("profile-image-saved", (event) => {
    const detail = (event as CustomEvent<{ fileName?: string }>).detail;
    setStatus(
      detail?.fileName
        ? `${detail.fileName}を保存しました。画像の変更に承認は不要です。`
        : "画像を保存しました。変更に承認は不要です。",
      "saved",
    );
  });

  applyButton.addEventListener("click", async () => {
    if (!file || !geometryReady) return;
    applyButton.disabled = true;
    root
      .querySelectorAll<HTMLButtonElement>("[data-crop-cancel]")
      .forEach((button) => {
        button.disabled = true;
      });
    cropMessage.value =
      mimeType === "image/gif"
        ? "アニメーションを保ちながら画像を調整しています…"
        : "画像を調整しています…";
    try {
      const side = viewport.getBoundingClientRect().width;
      const box = cropBox(
        image.naturalWidth,
        image.naturalHeight,
        side,
        fitScale,
        zoom,
        offsetX,
        offsetY,
      );
      const avatarUrl =
        mimeType === "image/gif"
          ? await makeGifAvatar(parsedGif!, box, (message) => {
              cropMessage.value = message;
            })
          : makeStaticAvatar(image, box);
      if (avatarUrl.length > profileImageMaxStoredUrlLength) {
        throw new Error(
          "調整後の画像が保存上限を超えています。別の画像を選択してください。",
        );
      }
      applied = true;
      setStatus(
        `${file.name}（${formatSize(file.size)}）を選択中です。保存ボタンで反映できます。`,
        "selected",
      );
      root.dispatchEvent(
        new CustomEvent<CroppedProfileImageDetail>("profile-image-cropped", {
          bubbles: true,
          detail: {
            avatarUrl,
            fileName: file.name,
            originalBytes: file.size,
          },
        }),
      );
      closeCropDialog();
      clearPreview();
    } catch (error) {
      cropMessage.value =
        error instanceof Error
          ? error.message
          : "画像を調整できませんでした。別の画像を選択してください。";
      setStatus(cropMessage.value, "error");
      applyButton.disabled = false;
    } finally {
      root
        .querySelectorAll<HTMLButtonElement>("[data-crop-cancel]")
        .forEach((button) => {
          button.disabled = false;
        });
    }
  });
};

export const initializeProfileImagePickers = () => {
  document
    .querySelectorAll<HTMLElement>("[data-profile-image-picker]")
    .forEach((root) => {
      if (root.dataset.ready === "true") return;
      root.dataset.ready = "true";
      openPicker(root);
    });
};
