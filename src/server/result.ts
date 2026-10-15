/** Queries for a singleton/aggregate must fail visibly if the contract is broken. */
export function one<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (rows.length !== 1 || row === undefined) throw new Error('Expected exactly one database row.');
  return row;
}
