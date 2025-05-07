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
import { TransactionFormatter } from '../utils/transaction-formatter';
import { SolanaEventParser } from '../utils/event-parser';
import { bnLayoutFormatter } from '../utils/bn-layout-formatter';
import pumpFunAmmIdl from '../idls/pump_amm_0.1.0.json';
import jupyterIdl from '../idls/idl.json';
import { getEvents } from '../utils/get-events';
import { Jupiter, jupiterIdl } from '../idls/jup';
import { intersection, difference } from 'lodash';
import { parseTokenChanges } from '../utils/parse-token-transfer';
import { getPrice } from '../utils/get-price';
import { Connection } from '@solana/web3.js';
const connection = new Connection('https://api.mainnet-beta.solana.com');
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

// Handle updates
async function handleStream() {
  const txn = await connection.getTransaction(
    '2Gnn4nBg1chnq75mEYAL8LESjb3sRLzm9EPtYcY9S54TeyShdQnuWeM1Lb6ZwSLgfmkrvXbvPCrrgYdXNeeSvmct',
    {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    }
  );
  if (txn) {
    // const txn = TXN_FORMATTER.formTransactionFromJson(
    //   transaction,
    //   Date.now()
    // );
    console.log('txn', txn.transaction.signatures[0]);
    const determineValue = isTransactionFromPool(txn);
    console.log('determineValue', determineValue);
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
            getPrice(event.data.outputMint).then((value) => {
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
            getPrice(event.data.inputMint).then((value) => {
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
            });
          }
        }
      }

      if (determineValue.PUMP_FUN) {
        let parsedTxn = decodePumpFunTxn(txn);
        if (parsedTxn && parsedTxn.events.length > 0) {
          // console.log('parsedTxn', parsedTxn.events);
          for (let event of parsedTxn.events) {
            getPrice('So11111111111111111111111111111111111111112').then(
              (value) => {
                if (event.name === 'SellEvent') {
                  const quoteAmount = event.data.quote_amount_out / 10 ** 9;
                  console.log(event.data.quote_amount_out);

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

      const tokenChanges = parseTokenChanges(txn);

      // const formattedTokenChanges = tokenChanges.filter(
      //   (t) => t.mint === SPECFIED_TOKEN.toBase58()
      // );
      // if (formattedTokenChanges.length > 0) {
      //   console.log('formattedTokenChanges', formattedTokenChanges);
      // }

      // console.log(
      //   new Date(),
      //   ':',
      //   `New transaction https://solscan.io/tx/${txn.transaction.signatures[0]} \n`
      // );
    }
  }
}

function decodePumpFunTxn(tx: VersionedTransactionResponse) {
  if (tx.meta?.err) return;
  //   console.log(JSON.stringify(JSON.stringify(tx)));
  const paredIxs = PUMP_FUN_IX_PARSER.parseTransactionData(
    tx.transaction.message,
    tx.meta.loadedAddresses
  );

  const pumpFunIxs = paredIxs;
  if (pumpFunIxs.length === 0) return;
  const events = PUMP_FUN_EVENT_PARSER.parseEvent(tx);
  console.log('result', events);
  const result = { instructions: pumpFunIxs, events };
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
    console.log('not');
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

function decodeJupyterTxn(tx: VersionedTransactionResponse) {
  if (tx.meta?.err) return;

  const jupyterIxs = JUPYTER_IX_PARSER.parseTransactionData(
    tx.transaction.message,
    tx.meta.loadedAddresses
  );

  const parsedIxs = jupyterIxs.filter((ix) =>
    ix.programId.equals(JUPYTER_PROGRAM_ID)
  );

  if (parsedIxs.length === 0) return;
  // const jupyterEvents = JUPYTER_EVENT_PARSER.parseEvent(tx);
  const result = { instructions: parsedIxs };
  bnLayoutFormatter(result);
  return result;
}

handleStream();
