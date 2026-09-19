function utf8Len(codePoint) {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

function findIndex(sortedArray, target) {
  let lo = 0;
  let hi = sortedArray.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sortedArray[mid] === target) return mid;
    if (sortedArray[mid] < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

export function makeOffsetMap(text) {
  const len = text.length;

  let isAscii = true;
  for (let i = 0; i < len; i++) {
    if (text.charCodeAt(i) > 0x7f) {
      isAscii = false;
      break;
    }
  }

  if (isAscii) {
    return {
      bytes: len,
      byteToChar(byte) {
        if (byte < 0 || byte > len) throw new RangeError(`byte offset out of range: ${byte}`);
        return byte;
      },
      charToByte(charIndex) {
        if (charIndex < 0 || charIndex > len) throw new RangeError(`char index out of range: ${charIndex}`);
        return charIndex;
      },
    };
  }

  const charOffsets = [];
  const byteOffsets = [];
  let byte = 0;
  let i = 0;
  while (i < len) {
    charOffsets.push(i);
    byteOffsets.push(byte);
    const cp = text.codePointAt(i);
    byte += utf8Len(cp);
    i += cp > 0xffff ? 2 : 1;
  }
  charOffsets.push(len);
  byteOffsets.push(byte);

  const totalBytes = byte;

  return {
    bytes: totalBytes,
    byteToChar(b) {
      if (b < 0 || b > totalBytes) throw new RangeError(`byte offset out of range: ${b}`);
      const idx = findIndex(byteOffsets, b);
      if (idx === -1) throw new RangeError(`byte offset ${b} is inside a multi-byte character`);
      return charOffsets[idx];
    },
    charToByte(c) {
      if (c < 0 || c > len) throw new RangeError(`char index out of range: ${c}`);
      const idx = findIndex(charOffsets, c);
      if (idx === -1) throw new RangeError(`char index ${c} is inside a surrogate pair`);
      return byteOffsets[idx];
    },
  };
}
