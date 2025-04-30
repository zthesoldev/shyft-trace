import {
  VersionedTransactionResponse,
} from '@solana/web3.js';

export function balanceChanges(tx: VersionedTransactionResponse, mint: string, pool: string): number {
  if (!tx.meta) return 0;
  const { preTokenBalances, postTokenBalances } = tx.meta;

  let preTokenBal = 0;
  let postTokenBal = 0;

  for (let i = 0; i < preTokenBalances.length; i++) {
    const preTokenBalance = preTokenBalances[i];
    if (preTokenBalance.mint === mint && preTokenBalance.owner === pool) {
      preTokenBal = preTokenBalance.uiTokenAmount.uiAmount;
    }
  }

  for (let i = 0; i < postTokenBalances.length; i++) {
    const postTokenBalance = postTokenBalances[i];
    if (postTokenBalance.mint === mint && postTokenBalance.owner === pool) {
      postTokenBal = postTokenBalance.uiTokenAmount.uiAmount;
    }
  }

  return Math.abs(postTokenBal - preTokenBal);
}
