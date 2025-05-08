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
  Message,
  MessageV0,
  ParsedTransactionWithMeta,
  PublicKey,
  VersionedTransactionResponse,
} from '@solana/web3.js';
import { Idl, Program, Provider } from '@coral-xyz/anchor';
import { SolanaParser } from '@shyft-to/solana-transaction-parser';
import { SubscribeRequestPing } from '@triton-one/yellowstone-grpc/dist/types/grpc/geyser';
import { TransactionFormatter } from './utils/transaction-formatter';
import { SolanaEventParser } from './utils/event-parser';
import { bnLayoutFormatter } from './utils/bn-layout-formatter';
import pumpFunAmmIdl from './idls/pump_amm_0.1.0.json';
import jupyterIdl from './idls/idl.json';
import { getEvents } from './utils/get-events';
import { Jupiter, jupiterIdl } from './idls/jup';
import { getPrice } from './utils/get-price';
import { logToFile } from './utils/file-logger';

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
  '8xhH7tDB6m1akaexEYsn8Qkb58r6EY8MA4t958mipump'
);

const POOL_ADDRESS = new PublicKey(
  '3gBqc6pZVgd3uTNg1KE7JXxTiNVMFoRqSbQF8BSLpk7w'
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
      logToFile('txn', txn.transaction.signatures[0]);
      const determineValue = isTransactionFromPool(txn);
      // let parsedTxn = decodeJupyterTxn(txn);
      if (txn) {
        if (determineValue.JUPITER) {
          const events = getEvents(program, txn);
          // const tokenTransfers = parseTokenTransfers(txn);
          // console.log('tokenTransfers', tokenTransfers);
          let swapEvents = events.filter((e) => e.name === 'swapEvent');

          const sellEvents = swapEvents
            .map((e) => {
              bnLayoutFormatter(e);
              return e;
            })
            .filter((e) => e.data.inputMint === SPECFIED_TOKEN.toBase58());

          if (sellEvents.length > 0) {
            for (let event of sellEvents) {
              getPrice(event.data.outputMint)
                .then((value) => {
                  let decimals = 6;
                  if (value.symbol == 'SOL') {
                    decimals = 9;
                  }
                  console.log(
                    'Jupiter SellEvent',
                    event.data.inputAmount / 10 ** 6,
                    `(${value.symbol}):`,
                    event.data.outputAmount / 10 ** decimals,
                    'usd:',
                    (value.maxPrice * event.data.outputAmount) / 10 ** decimals
                  );
                  console.log(
                    new Date(),
                    ':',
                    `New transaction https://solscan.io/tx/${txn.transaction.signatures[0]} \n`
                  );
                })
                .catch((err) => {
                  console.log(err);
                });
            }
          }

          const buyEvents = swapEvents
            .map((e) => {
              bnLayoutFormatter(e);
              return e;
            })
            .filter((e) => e.data.outputMint === SPECFIED_TOKEN.toBase58());

          if (buyEvents.length > 0) {
            for (let event of buyEvents) {
              getPrice(event.data.inputMint)
                .then((value) => {
                  let decimals = 6;
                  if (value.symbol == 'SOL') {
                    decimals = 9;
                  }
                  console.log(
                    'Jupiter BuyEvent',
                    event.data.outputAmount / 10 ** 6,
                    `(${value.symbol}):`,
                    event.data.inputAmount / 10 ** decimals,
                    'usd:',
                    (value.maxPrice * event.data.inputAmount) / 10 ** decimals
                  );
                  console.log(
                    new Date(),
                    ':',
                    `New transaction https://solscan.io/tx/${txn.transaction.signatures[0]} \n`
                  );
                })
                .catch((err) => console.log(err));
            }
          }
        }
        if (determineValue.PUMP_FUN) {
          let parsedTxn = decodePumpFunTxn(txn);
          if (parsedTxn && parsedTxn.events.length > 0) {
            // logToFile('parsedTxn', parsedTxn.events);
            for (let event of parsedTxn.events) {
              getPrice('So11111111111111111111111111111111111111112').then(
                (value) => {
                  if (event.name === 'SellEvent') {
                    const quoteAmount = event.data.quote_amount_out / 10 ** 9;
                    console.log(
                      event.name,
                      event.data.base_amount_in / 10 ** 6,
                      'sol:',
                      quoteAmount,
                      'usd:',
                      value.maxPrice * quoteAmount
                    );
                  } else {
                    const quoteAmount = event.data.quote_amount_in / 10 ** 9;
                    console.log(
                      event.name,
                      event.data.base_amount_out / 10 ** 6,
                      'sol:',
                      quoteAmount,
                      'usd:',
                      value.maxPrice * quoteAmount
                    );
                  }
                  console.log(
                    new Date(),
                    ':',
                    `New transaction https://solscan.io/tx/${txn.transaction.signatures[0]} \n`
                  );
                }
              );
            }
          }
        }

        // const tokenChanges = parseTokenChanges(txn);

        // const formattedTokenChanges = tokenChanges.filter(
        //   (t) => t.mint === SPECFIED_TOKEN.toBase58()
        // );
        // if (formattedTokenChanges.length > 0) {
        //   logToFile('formattedTokenChanges', formattedTokenChanges);
        // }

        // logToFile(
        //   new Date(),
        //   ':',
        //   `New transaction https://solscan.io/tx/${txn.transaction.signatures[0]} \n`
        // );
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
      console.log('Stream error, restarting in 1 second...', error);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

const client = new Client(
  process.env.ENDPOINT!,
  process.env.X_TOKEN,
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
        // // PUMP_FUN_AMM_PROGRAM_ID.toBase58(),
        // // JUPYTER_PROGRAM_ID.toBase58(),
        // // OPEN_BOOK_PROGRAM_ID.toBase58(),
      ],
      accountExclude: [],
      accountRequired: [POOL_ADDRESS.toBase58(), SPECFIED_TOKEN.toBase58()],
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

function decodePumpFunTxn(tx: VersionedTransactionResponse) {
  if (tx.meta?.err) return;
  const events = PUMP_FUN_EVENT_PARSER.parseEvent(tx);
  const result = { events };
  bnLayoutFormatter(result);
  return result;
}

function isTransactionFromPool(
  txn: VersionedTransactionResponse | ParsedTransactionWithMeta
) {
  let returnValue = {
    JUPITER: false,
    PUMP_FUN: false,
    OPEN_BOOK: false,
  };
  let programIds: string[] = [];

  if (
    txn?.transaction.message instanceof Message ||
    txn?.transaction.message instanceof MessageV0
  ) {
    const accountKeys = txn.transaction.message.staticAccountKeys;
    txn.transaction.message.compiledInstructions.forEach((instruction) => {
      const programId = accountKeys[instruction.programIdIndex];
      if (programId) {
        programIds.push(programId.toBase58());
      }
    });
    programIds.push(
      ...txn.transaction.message.staticAccountKeys.map((v) => v.toBase58())
    );
  } else {
    txn.transaction.message.instructions.forEach((instruction) => {
      programIds.push(instruction.programId.toBase58());
    });
  }
  const lookupAddresses = [];
  // Check for loaded addresses and add them to programIds
  if (txn.meta?.loadedAddresses) {
    if (txn.meta.loadedAddresses.writable) {
      txn.meta.loadedAddresses.writable.forEach((address) => {
        if (address) {
          programIds.push(address.toBase58());
          lookupAddresses.push(address.toBase58());
        }
      });
    }
    if (txn.meta.loadedAddresses.readonly) {
      txn.meta.loadedAddresses.readonly.forEach((address) => {
        if (address) {
          const read = new PublicKey(address);
          programIds.push(read.toBase58());
          lookupAddresses.push(read.toBase58());
        }
      });
    }
  }
  if (lookupAddresses.includes(SPECFIED_TOKEN.toBase58())) {
  }
  if (programIds.includes(JUPYTER_PROGRAM_ID.toBase58())) {
    returnValue.JUPITER = true;
  }
  if (programIds.includes(PUMP_FUN_AMM_PROGRAM_ID.toBase58())) {
    returnValue.PUMP_FUN = true;
  }
  if (programIds.includes(OPEN_BOOK_PROGRAM_ID.toBase58())) {
    returnValue.OPEN_BOOK = true;
  }
  // console.log('returnValue', returnValue);
  return returnValue;
}
