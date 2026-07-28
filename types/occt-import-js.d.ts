/**
 * occt-import-js 未提供类型声明。这里只声明我们实际用到的最小面,
 * 不假装覆盖整个 OCCT API —— 用到新接口时再补,避免类型谎报能力。
 */
declare module "occt-import-js" {
  interface OcctMeshAttribute {
    array: number[];
  }
  interface OcctMesh {
    name?: string;
    color?: [number, number, number];
    attributes: {
      position: OcctMeshAttribute;
      normal?: OcctMeshAttribute;
    };
    index?: OcctMeshAttribute;
  }
  interface OcctReadResult {
    success: boolean;
    meshes: OcctMesh[];
  }
  interface OcctModule {
    ReadStepFile(content: Uint8Array, params: unknown): OcctReadResult;
  }
  type OcctFactory = (options?: { locateFile?: (file: string) => string }) => Promise<OcctModule>;
  const factory: OcctFactory;
  export default factory;
}
