declare module "gifenc" {
  export type GifPalette = Array<
    [number, number, number] | [number, number, number, number]
  >;

  export interface GifFrameOptions {
    delay?: number;
    dispose?: number;
    palette?: GifPalette;
    repeat?: number;
    transparent?: boolean;
    transparentIndex?: number;
  }

  export interface GifEncoder {
    bytes(): Uint8Array;
    finish(): void;
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: GifFrameOptions,
    ): void;
  }

  export function GIFEncoder(options?: {
    auto?: boolean;
    initialCapacity?: number;
  }): GifEncoder;
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifPalette,
    format?: "rgb565" | "rgb444" | "rgba4444",
  ): Uint8Array;
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: {
      clearAlpha?: boolean;
      clearAlphaColor?: number;
      clearAlphaThreshold?: number;
      format?: "rgb565" | "rgb444" | "rgba4444";
      oneBitAlpha?: boolean | number;
    },
  ): GifPalette;
}
