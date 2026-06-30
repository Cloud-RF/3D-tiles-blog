// Shared Draco compression helper used by both the Vite dev server
// (vite.config.js) and the production Node server (server.js).
export async function compressGlb(input) {
  const { NodeIO } = await import('@gltf-transform/core');
  const { KHRONOS_EXTENSIONS } = await import('@gltf-transform/extensions');
  const { draco } = await import('@gltf-transform/functions');
  const draco3d = await import('draco3d');

  const io = new NodeIO()
    .registerExtensions(KHRONOS_EXTENSIONS)
    .registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'draco3d.encoder': await draco3d.createEncoderModule(),
    });

  const doc = await io.readBinary(new Uint8Array(input));
  await doc.transform(draco({ encodeSpeed: 5, decodeSpeed: 5 }));
  return io.writeBinary(doc);
}
