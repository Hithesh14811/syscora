const REDACTED = "***REDACTED***";

function shouldRedactKey(key) {
  if (/^key$/i.test(key)) {
    return false;
  }
  return /(value|secret|token|password|credential|apiKey|accessKey|privateKey)/i.test(key);
}

export function redactSensitiveData(input) {
  if (Array.isArray(input)) {
    return input.map((item) => redactSensitiveData(item));
  }

  if (!input || typeof input !== "object") {
    return input;
  }

  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (shouldRedactKey(key)) {
      output[key] = REDACTED;
      continue;
    }
    output[key] = redactSensitiveData(value);
  }
  return output;
}

export { REDACTED };
