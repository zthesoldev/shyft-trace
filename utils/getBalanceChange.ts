import {
  VersionedTransactionResponse,
} from '@solana/web3.js';

export function balanceChanges(tx: VersionedTransactionResponse, mint: string, pool: string): number {
  if (!tx.meta) return 0;
  const { preTokenBalances, postTokenBalances } = tx.meta;
  for (let i = 0; i < preTokenBalances.length; i++) {
    const preTokenBalance = preTokenBalances[i];
    const postTokenBalance = postTokenBalances[i];
    if (preTokenBalance.mint === mint && preTokenBalance.owner === pool) {
      return Math.abs(postTokenBalance.uiTokenAmount.uiAmount - preTokenBalance.uiTokenAmount.uiAmount);
    }
  }
  return 0;
}
