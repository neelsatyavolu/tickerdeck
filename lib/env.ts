/** A setting the app cannot work without. Read where it is used, so builds don't need it. */
export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
