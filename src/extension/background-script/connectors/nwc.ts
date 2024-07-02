import { NWCClient } from "@getalby/sdk/dist/NWCClient";
import lightningPayReq from "bolt11-signet";
import Hex from "crypto-js/enc-hex";
import SHA256 from "crypto-js/sha256";
import { Account } from "~/types";
import Connector, {
  CheckPaymentArgs,
  CheckPaymentResponse,
  ConnectPeerArgs,
  ConnectPeerResponse,
  ConnectorTransaction,
  GetBalanceResponse,
  GetInfoResponse,
  GetTransactionsResponse,
  KeysendArgs,
  MakeInvoiceArgs,
  MakeInvoiceResponse,
  SendPaymentArgs,
  SendPaymentResponse,
  SignMessageArgs,
  SignMessageResponse,
  TlvRecord,
} from "./connector.interface";

interface Config {
  nostrWalletConnectUrl: string;
}

class NWCConnector implements Connector {
  config: Config;
  nwc: NWCClient;

  get supportedMethods() {
    return [
      "getInfo",
      "makeInvoice",
      "sendPayment",
      "sendPaymentAsync",
      "getBalance",
      "keysend",
      "getTransactions",
      "signMessage",
    ];
  }

  constructor(account: Account, config: Config) {
    this.config = config;
    this.nwc = new NWCClient({
      nostrWalletConnectUrl: this.config.nostrWalletConnectUrl,
    });
  }

  async init() {
    return Promise.resolve();
  }

  async unload() {
    this.nwc.close();
  }

  async getInfo(): Promise<GetInfoResponse> {
    const info = await this.nwc.getInfo();
    return {
      data: info,
    };
  }

  async getBalance(): Promise<GetBalanceResponse> {
    const balance = await this.nwc.getBalance();
    return {
      data: { balance: balance.balance, currency: "BTC" },
    };
  }

  async getTransactions(): Promise<GetTransactionsResponse> {
    const listTransactionsResponse = await this.nwc.listTransactions({
      unpaid: false,
      limit: 50, // restricted by relay max event payload size
    });

    const transactions: ConnectorTransaction[] =
      listTransactionsResponse.transactions.map(
        (transaction, index): ConnectorTransaction => ({
          id: `${index}`,
          memo: transaction.description,
          preimage: transaction.preimage,
          payment_hash: transaction.payment_hash,
          settled: true,
          settleDate: transaction.settled_at * 1000,
          totalAmount: transaction.amount,
          type: transaction.type == "incoming" ? "received" : "sent",
        })
      );
    return {
      data: {
        transactions,
      },
    };
  }

  async makeInvoice(args: MakeInvoiceArgs): Promise<MakeInvoiceResponse> {
    const invoice = await this.nwc.makeInvoice({
      amount:
        typeof args.amount === "number"
          ? args.amount
          : parseFloat(args.amount) || 0,
      description: args.memo,
    });
    let rHash = invoice.payment_hash;

    if (!rHash) {
      const decodedInvoice = lightningPayReq.decode(invoice.invoice);
      rHash = decodedInvoice.tags.find((tag) => tag.tagName === "payment_hash")
        ?.data as string;
      if (!rHash) {
        throw new Error("Could not find payment hash in invoice");
      }
    }

    return {
      data: {
        paymentRequest: invoice.invoice,
        rHash,
      },
    };
  }

  async sendPayment(args: SendPaymentArgs): Promise<SendPaymentResponse> {
    const invoice = lightningPayReq.decode(args.paymentRequest);
    const paymentHash = invoice.tags.find(
      (tag) => tag.tagName === "payment_hash"
    )?.data as string | undefined;
    if (!paymentHash) {
      throw new Error("Could not find payment hash in invoice");
    }

    const response = await this.nwc.payInvoice({
      invoice: args.paymentRequest,
    });
    const total_amt = invoice.millisatoshis
      ? parseInt(invoice.millisatoshis || "0", 10) / 1000
      : invoice.satoshis ?? 0;

    return {
      data: {
        preimage: response.preimage,
        paymentHash,
        route: {
          // TODO: how to get amount paid for zero-amount invoices?
          total_amt: total_amt,
          // TODO: How to get fees from WebLN?
          total_fees: 0,
        },
      },
    };
  }

  async keysend(args: KeysendArgs): Promise<SendPaymentResponse> {
    const data = await this.nwc.payKeysend({
      pubkey: args.pubkey,
      amount: args.amount,
      tlv_records: this.convertCustomRecords(args.customRecords),
    });

    const paymentHash = SHA256(data.preimage).toString(Hex);

    return {
      data: {
        preimage: data.preimage,
        paymentHash,

        route: {
          total_amt: args.amount,
          // TODO: How to get fees from WebLN?
          total_fees: 0,
        },
      },
    };
  }

  async checkPayment(args: CheckPaymentArgs): Promise<CheckPaymentResponse> {
    try {
      const response = await this.nwc.lookupInvoice({
        payment_hash: args.paymentHash,
      });

      return {
        data: {
          paid: !!response.settled_at,
          preimage: response.preimage,
        },
      };
    } catch (error) {
      console.error(error);
      return {
        data: {
          paid: false,
        },
      };
    }
  }

  async signMessage(args: SignMessageArgs): Promise<SignMessageResponse> {
    const response = await this.nwc.signMessage({ message: args.message });

    return Promise.resolve({
      data: {
        message: response.message,
        signature: response.signature,
      },
    });
  }

  connectPeer(args: ConnectPeerArgs): Promise<ConnectPeerResponse> {
    throw new Error("Method not implemented.");
  }

  private convertCustomRecords(
    customRecords: Record<string, string>
  ): TlvRecord[] {
    return Object.entries(customRecords).map(([key, value]) => ({
      type: parseInt(key, 10),
      value: value,
    }));
  }
}

export default NWCConnector;
