export function browserCompatibleWav(input) {
  const bytes = new Uint8Array(input);
  const view = new DataView(input);
  if (bytes.length < 44 || view.getUint32(0, false) !== 0x52494646 || view.getUint32(8, false) !== 0x57415645) {
    throw new Error('Voice provider returned invalid WAV audio');
  }
  let format;
  let dataOffset;
  let dataLength;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const kind = view.getUint32(offset, false);
    const length = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + length > bytes.length) throw new Error('Voice provider returned truncated WAV audio');
    if (kind === 0x666d7420) {
      if (length < 16) throw new Error('Voice provider returned invalid WAV format');
      format = { code: view.getUint16(start, true), channels: view.getUint16(start + 2, true),
        rate: view.getUint32(start + 4, true), bits: view.getUint16(start + 14, true) };
    }
    if (kind === 0x64617461) { dataOffset = start; dataLength = length; }
    offset = start + length + (length % 2);
  }
  if (!format || dataOffset === undefined || !format.channels || format.channels > 2 || !format.rate || !dataLength) {
    throw new Error('Voice provider returned incomplete WAV audio');
  }
  if (format.code === 1 && format.bits === 16) return input;
  if (format.code !== 3 || format.bits !== 32 || dataLength % 4) {
    throw new Error('Voice provider returned unsupported WAV audio');
  }
  const sampleCount = dataLength / 4;
  if (sampleCount % format.channels) throw new Error('Voice provider returned incomplete samples');
  const output = new ArrayBuffer(44 + sampleCount * 2);
  const pcm = new DataView(output);
  pcm.setUint32(0, 0x52494646, false);
  pcm.setUint32(4, output.byteLength - 8, true);
  pcm.setUint32(8, 0x57415645, false);
  pcm.setUint32(12, 0x666d7420, false);
  pcm.setUint32(16, 16, true);
  pcm.setUint16(20, 1, true);
  pcm.setUint16(22, format.channels, true);
  pcm.setUint32(24, format.rate, true);
  pcm.setUint32(28, format.rate * format.channels * 2, true);
  pcm.setUint16(32, format.channels * 2, true);
  pcm.setUint16(34, 16, true);
  pcm.setUint32(36, 0x64617461, false);
  pcm.setUint32(40, sampleCount * 2, true);
  for (let index = 0; index < sampleCount; index++) {
    const sample = view.getFloat32(dataOffset + index * 4, true);
    const clipped = Math.max(-1, Math.min(1, Number.isFinite(sample) ? sample : 0));
    pcm.setInt16(44 + index * 2, clipped < 0 ? Math.round(clipped * 32768) : Math.round(clipped * 32767), true);
  }
  return output;
}

