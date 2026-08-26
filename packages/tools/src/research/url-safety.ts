import { isIP } from 'node:net';
import { z } from 'zod';

export function isSafePublicWebUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) {
    return false;
  }

  const hostname = parsed.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (!hostname || isIP(hostname) !== 0) {
    return false;
  }

  return hostname !== 'localhost' && !hostname.endsWith('.localhost') && !hostname.endsWith('.local') && !hostname.endsWith('.internal');
}

export function isPublicIpAddress(value: string): boolean {
  const family = isIP(value);
  if (family === 4) {
    const octets = value.split('.').map(Number);
    if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;

    const first = octets[0];
    const second = octets[1];
    const third = octets[2];
    if (first === undefined || second === undefined || third === undefined) return false;
    return !(
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 0 && third === 0) ||
      (first === 192 && second === 168) ||
      (first === 198 && second >= 18 && second <= 19) ||
      (first === 198 && second === 51 && third === 100) ||
      (first === 203 && second === 0 && third === 113) ||
      first >= 224
    );
  }

  if (family !== 6) return false;

  const words = parseIpv6Words(value);
  if (!words) return false;

  const first = words[0];
  if (first === undefined) return false;
  const isUnspecifiedOrLoopback = words.slice(0, 7).every(word => word === 0);
  if (isUnspecifiedOrLoopback) return false;

  const isIpv4Mapped = words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff;
  if (isIpv4Mapped) {
    const word6 = words[6];
    const word7 = words[7];
    if (word6 === undefined || word7 === undefined) return false;
    const octets = [word6 >> 8, word6 & 0xff, word7 >> 8, word7 & 0xff];
    return isPublicIpAddress(octets.join('.'));
  }

  return !(
    words.slice(0, 5).every(word => word === 0) ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00 ||
    (first === 0x2001 && words[1] === 0x0db8) ||
    first === 0x2002
  );
}

function parseIpv6Words(value: string): number[] | null {
  const sections = value.toLowerCase().split('::');
  if (sections.length > 2) return null;

  const parseSection = (section: string): number[] => {
    if (!section) return [];
    const parts = section.split(':');
    const words: number[] = [];
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      if (part === undefined) return [];
      if (part.includes('.')) {
        if (index !== parts.length - 1) return [];
        const octets = part.split('.').map(Number);
        if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return [];
        const first = octets[0];
        const second = octets[1];
        const third = octets[2];
        const fourth = octets[3];
        if (first === undefined || second === undefined || third === undefined || fourth === undefined) return [];
        words.push((first << 8) | second, (third << 8) | fourth);
        continue;
      }
      const word = Number.parseInt(part, 16);
      if (!part || !Number.isInteger(word) || word < 0 || word > 0xffff) return [];
      words.push(word);
    }
    return words;
  };

  const leftSection = sections[0] || '';
  const rightSection = sections[1] || '';
  const left = parseSection(leftSection);
  const right = sections.length === 2 ? parseSection(rightSection) : [];
  if (!left.length && leftSection) return null;
  if (sections.length === 2 && !right.length && rightSection) return null;

  if (sections.length === 1) return left.length === 8 ? left : null;
  const missing = 8 - left.length - right.length;
  return missing > 0 ? [...left, ...Array.from({ length: missing }, () => 0), ...right] : null;
}

export const SafeWebUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine(isSafePublicWebUrl, 'Only credential-free HTTP(S) URLs with a public hostname are allowed.');
