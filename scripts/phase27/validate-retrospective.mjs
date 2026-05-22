#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const [, , filePath] = process.argv;

if (!filePath) {
  console.error('Usage: node scripts/phase27/validate-retrospective.mjs <path>');
  process.exit(2);
}

let text;
try {
  text = readFileSync(filePath, 'utf8');
} catch (error) {
  console.error(`Could not read retrospective artifact: ${error.message}`);
  process.exit(2);
}

const requiredSections = [
  'Incidents',
  'Non-incidents',
  'Improvements',
  'Next-event carry-forward',
  'Field scan evidence',
  'Offline sync evidence',
  'Settlement evidence',
  'v2.0 completion evidence',
];

const failures = [];

for (const section of requiredSections) {
  const pattern = new RegExp(`^## ${escapeRegExp(section)}\\s*$`, 'm');
  if (!pattern.test(text)) {
    failures.push(`Missing required section: ${section}`);
  }
}

const bannedPatterns = [
  { label: 'JWT-looking token', pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/ },
  { label: 'Authorization header', pattern: /\bAuthorization\s*:/i },
  { label: 'Cookie header', pattern: /\bCookie\s*:/i },
  { label: 'Toss/provider payment key', pattern: /\b(?:test|live)_(?:sk|ck)_[A-Za-z0-9_=-]{8,}\b/i },
  { label: 'raw paymentKey value', pattern: /\bpaymentKey\s*[:=]\s*[A-Za-z0-9_-]{8,}\b/i },
  { label: 'OTP value', pattern: /\b(?:otp|verification\s*code|인증번호)\s*[:=]\s*\d{4,8}\b/i },
  { label: 'raw QR token', pattern: /\b(?:qrToken|qr_token|rawQrToken|ticketToken|qr-ticket-token)\s*[:=]\s*[A-Za-z0-9._-]{12,}\b/i },
  { label: 'raw JTI value', pattern: /\b(?:rawJti|jti)\s*[:=]\s*[A-Za-z0-9._-]{12,}\b/i },
  { label: 'full email address', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
  { label: 'full phone number', pattern: /(?:\+?\d[\s-]?){9,15}/ },
  { label: 'unmasked IPv4 address', pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/ },
];

for (const { label, pattern } of bannedPatterns) {
  if (pattern.test(text)) {
    failures.push(`Sensitive pattern found: ${label}`);
  }
}

const evidencePathPattern =
  /(?:^|[\s"'(])(?:\.planning|docs|apps|scripts|evidence|\/)[^\s"'()|]+/i;
const claimPattern = /\b(?:PASS|PASSED|SUCCESS|SUCCESSFUL|COMPLETE|COMPLETED|CLOSED|GREEN|완료|성공)\b/i;

text.split(/\r?\n/).forEach((line, index) => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) {
    return;
  }
  if (!claimPattern.test(trimmed)) {
    return;
  }
  if (!evidencePathPattern.test(trimmed)) {
    failures.push(
      `Evidence-backed result claim without evidence path at line ${index + 1}: ${trimForReport(trimmed)}`,
    );
  }
});

if (failures.length > 0) {
  console.error('Retrospective validation failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Retrospective validation passed: ${filePath}`);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function trimForReport(value) {
  return value.length > 140 ? `${value.slice(0, 137)}...` : value;
}
