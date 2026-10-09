/**
 * Local spend limit for x402 auto-payments.
 *
 * Deliberately dependency-free (no viem, no signer) so the CLI can validate
 * `--x402-max-amount` at startup without pulling in the bundled crypto code.
 *
 * The limit is enforced in `signPayment()`, the single choke point every
 * automatic payment path goes through: proactive `_meta.x402` signing, the
 * HTTP 402 fallback, and the bridge's payment-required tool-result retry.
 */

import { ClientError } from '../errors.js';

/** Decimals of the stablecoins x402 settles in (USDC on Base). */
export const USDC_DECIMALS = 6;

/** Smallest payment that can be expressed on-chain, in USD. */
export const MIN_AMOUNT_USD = 1 / 10 ** USDC_DECIMALS;

/**
 * A payment was refused locally because it exceeded the session's spend limit.
 *
 * Distinct from other signing failures on purpose: the payment paths swallow
 * signing errors and let the request go out unpaid, which for a spend limit
 * would silently degrade into "call the paid tool without paying". Callers
 * re-throw this one so the limit is always visible.
 */
export class X402PaymentLimitError extends ClientError {}

/** Convert a USD amount to atomic units of a 6-decimal stablecoin. */
export function usdToAtomicUnits(usd: number): bigint {
  return BigInt(Math.round(usd * 10 ** USDC_DECIMALS));
}

/** Format atomic units as USD, keeping cents but not trailing noise ($0.50, $0.000125). */
export function formatUsdAmount(atomicUnits: bigint): string {
  const usd = Number(atomicUnits) / 10 ** USDC_DECIMALS;
  return `$${usd.toFixed(USDC_DECIMALS).replace(/(\.\d{2}\d*?)0+$/, '$1')}`;
}

/**
 * Validate a `--x402-max-amount` value and return it in USD.
 * Throws a `ClientError` with the expected format when it is not a usable amount.
 */
export function parseMaxAmountUsd(value: string | number): number {
  const usd = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isFinite(usd) || usd < MIN_AMOUNT_USD) {
    throw new ClientError(
      `Invalid --x402-max-amount value: "${String(value)}". Expected a dollar amount of at least ${MIN_AMOUNT_USD.toFixed(USDC_DECIMALS)} (e.g. 0.50).`
    );
  }
  return usd;
}

/**
 * A payment was refused locally because its recipient is not on the session's
 * `--x402-allow-payee` list. A subclass of the spend-limit error on purpose: every
 * payment path already re-throws that one instead of letting the call go out unpaid.
 */
export class X402PayeeNotAllowedError extends X402PaymentLimitError {}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * Validate a `--x402-allow-payee` value (one address, or several separated by commas)
 * and return the addresses lowercased, without duplicates.
 */
export function parseAllowedPayees(value: string | readonly string[]): string[] {
  const parts = (typeof value === 'string' ? [value] : value)
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter((v) => v !== '');
  const bad = parts.find((v) => !EVM_ADDRESS.test(v));
  if (parts.length === 0 || bad !== undefined) {
    throw new ClientError(
      `Invalid --x402-allow-payee value: "${bad ?? String(value)}". Expected one or more 0x addresses (40 hex characters), separated by commas.`
    );
  }
  return [...new Set(parts.map((v) => v.toLowerCase()))];
}
