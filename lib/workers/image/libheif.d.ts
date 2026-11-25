declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  export interface HeifImage {
    is_primary(): boolean;
    get_width(): number;
    get_height(): number;
    display(destination: ImageData, callback: (result: ImageData | null) => void): void;
    free(): void;
  }

  export interface HeifModule {
    HeifDecoder: new () => {
      decode(bytes: Uint8Array): HeifImage[];
      decoder: object | null;
    };
    heif_context_free(context: object): void;
  }

  export default function initialize(): Promise<HeifModule>;
}
