import 'dotenv/config';
import Client, {
  CommitmentLevel,
  SubscribeRequestAccountsDataSlice,
  SubscribeRequestFilterAccounts,
  SubscribeRequestFilterBlocks,
  SubscribeRequestFilterBlocksMeta,
  SubscribeRequestFilterEntry,
  SubscribeRequestFilterSlots,
  SubscribeRequestFilterTransactions,
} from '@triton-one/yellowstone-grpc';
import {
  PublicKey,
} from '@solana/web3.js';
import { Idl, Program, Provider } from '@coral-xyz/anchor';
import { SolanaParser } from '@shyft-to/solana-transaction-parser';
import { SubscribeRequestPing } from '@triton-one/yellowstone-grpc/dist/types/grpc/geyser';
import { TransactionFormatter } from './utils/transaction-formatter';
import { SolanaEventParser } from './utils/event-parser';
import pumpFunAmmIdl from './idls/pump_amm_0.1.0.json';
import jupyterIdl from './idls/idl.json';
import { Jupiter, jupiterIdl } from './idls/jup';
import { balanceChanges } from './utils/getBalanceChange';

interface SubscribeRequest {
  accounts: { [key: string]: SubscribeRequestFilterAccounts };
  slots: { [key: string]: SubscribeRequestFilterSlots };
  transactions: { [key: string]: SubscribeRequestFilterTransactions };
  transactionsStatus: { [key: string]: SubscribeRequestFilterTransactions };
  blocks: { [key: string]: SubscribeRequestFilterBlocks };
  blocksMeta: { [key: string]: SubscribeRequestFilterBlocksMeta };
  entry: { [key: string]: SubscribeRequestFilterEntry };
  commitment?: CommitmentLevel | undefined;
  accountsDataSlice: SubscribeRequestAccountsDataSlice[];
  ping?: SubscribeRequestPing | undefined;
}

const SPECFIED_TOKEN = new PublicKey(
  '8ncucXv6U6epZKHPbgaEBcEK399TpHGKCquSt4RnmX4f'
);

const POOL_ADDRESS = new PublicKey(
  '6WwcmiRJFPDNdFmtgVQ8eY1zxMzLKGLrYuUtRy4iZmye'
);

const OPEN_BOOK_PROGRAM_ID = new PublicKey(
  'opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb'
);
const TXN_FORMATTER = new TransactionFormatter();
const PUMP_FUN_AMM_PROGRAM_ID = new PublicKey(
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'
);

const JUPYTER_PROGRAM_ID = new PublicKey(
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'
);

export const program = new Program<Jupiter>(jupiterIdl, {} as Provider);

const JUPYTER_IX_PARSER = new SolanaParser([]);
JUPYTER_IX_PARSER.addParserFromIdl(
  JUPYTER_PROGRAM_ID.toBase58(),
  jupyterIdl as Idl
);
const JUPYTER_EVENT_PARSER = new SolanaEventParser([], null);
JUPYTER_EVENT_PARSER.addParserFromIdl(
  JUPYTER_PROGRAM_ID.toBase58(),
  jupyterIdl as Idl
);

const PUMP_FUN_IX_PARSER = new SolanaParser([]);
PUMP_FUN_IX_PARSER.addParserFromIdl(
  PUMP_FUN_AMM_PROGRAM_ID.toBase58(),
  pumpFunAmmIdl as Idl
);
const PUMP_FUN_EVENT_PARSER = new SolanaEventParser([], null);
PUMP_FUN_EVENT_PARSER.addParserFromIdl(
  PUMP_FUN_AMM_PROGRAM_ID.toBase58(),
  pumpFunAmmIdl as Idl
);
PUMP_FUN_EVENT_PARSER.addParserFromIdl(
  JUPYTER_PROGRAM_ID.toBase58(),
  jupyterIdl as Idl
);

async function handleStream(client: Client, args: SubscribeRequest) {
  // Subscribe for events
  const stream = await client.subscribe();

  // Create `error` / `end` handler
  const streamClosed = new Promise<void>((resolve, reject) => {
    stream.on('error', (error) => {
      console.log('ERROR', error);
      reject(error);
      stream.end();
    });
    stream.on('end', () => {
      resolve();
    });
    stream.on('close', () => {
      resolve();
    });
  });

  // Handle updates
  stream.on('data', (data) => {
    if (data?.transaction) {
      const txn = TXN_FORMATTER.formTransactionFromJson(
        data.transaction,
        Date.now()
      );
      const logMessages = txn.meta?.logMessages || [];
      if (logMessages.length > 0) {
        let sell = false;
        let buy = false;
        for (let log of logMessages) {
          if (log.includes('Instruction: Swap')) {
            sell = false;
            buy = false;
            break;
          }
          if (log.includes('Instruction: Sell')) {
            if (buy) {
              buy = false;
              break;
            }
            sell = true;
          }
          if (log.includes('Instruction: Buy')) {
            if (sell) {
              sell = false;
              break;
            }
            buy = true;
          }
        }
        if (buy) {
          console.log(`https://solscan.io/tx/${txn.transaction.signatures[0]}`);
          const solChanges = balanceChanges(txn, 'So11111111111111111111111111111111111111112', POOL_ADDRESS.toBase58());
          // const tokenChanges = balanceChanges(txn, SPECFIED_TOKEN.toBase58(), POOL_ADDRESS.toBase58());

          // console.log(`[BUY] => SOL: ${solChanges} | TOKEN: ${tokenChanges}`);
          console.log(`[BUY] => SOL: ${solChanges}`);
        }
        if (sell) {
          console.log(`https://solscan.io/tx/${txn.transaction.signatures[0]}`);
          const solChanges = balanceChanges(txn, 'So11111111111111111111111111111111111111112', POOL_ADDRESS.toBase58());

          // console.log(`[Sell] => TOKEN: ${tokenChanges} | SOL: ${solChanges}`);
          console.log(`[Sell] => SOL: ${solChanges}`);
        }
      }
    }
  });

  // Send subscribe request
  await new Promise<void>((resolve, reject) => {
    stream.write(args, (err: any) => {
      if (err === null || err === undefined) {
        resolve();
      } else {
        reject(err);
      }
    });
  }).catch((reason) => {
    console.error('the reason', reason);
    throw reason;
  });

  await streamClosed;
}

async function subscribeCommand(client: Client, args: SubscribeRequest) {
  while (true) {
    try {
      await handleStream(client, args);
    } catch (error) {
      console.error('Stream error, restarting in 1 second...', error);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

const client = new Client(
  process.env.ENDPOINT!,
  undefined,
  undefined
);

const req: SubscribeRequest = {
  accounts: {},
  slots: {},
  transactions: {
    pumpFun: {
      vote: false,
      failed: false,
      accountInclude: [
        PUMP_FUN_AMM_PROGRAM_ID.toBase58(),
      ],
      accountExclude: [],
      accountRequired: [SPECFIED_TOKEN.toBase58(), POOL_ADDRESS.toBase58()],
    },
  },
  transactionsStatus: {},
  entry: {},
  blocks: {},
  blocksMeta: {},
  accountsDataSlice: [],
  ping: undefined,
  commitment: CommitmentLevel.CONFIRMED,
};

subscribeCommand(client, req);

