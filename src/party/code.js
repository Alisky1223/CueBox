// No 0/o, 1/l/i: codes get read aloud and typed by hand.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const LENGTH = 6;
const VALID = new RegExp(`^[${ALPHABET}]{${LENGTH}}$`);

export function makeCode(random = Math.random) {
  let code = "";
  for (let i = 0; i < LENGTH; i++) code += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return code;
}

/** Normalizes what the user typed or pasted; null if it isn't a valid code. */
export function parseCode(input) {
  const code = input.trim().toLowerCase().replace(/[\s-]/g, "");
  return VALID.test(code) ? code : null;
}
