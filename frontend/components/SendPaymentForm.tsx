/**
 * components/SendPaymentForm.tsx
 * Send XLM or USDC payment from the connected wallet.
 */
import { useEffect, useMemo, useState } from "react";
import { buildPaymentTransaction, submitTransaction, isValidStellarAddress, explorerUrl } from "@/lib/stellar";
import { signTransactionWithWallet } from "@/lib/wallet";
import clsx from "clsx";

type Asset = "XLM" | "USDC";

interface AddressBookContact {
  nickname: string;
  address: string;
}

const ADDRESS_BOOK_KEY = "marketpay_address_book";

function loadContacts(): AddressBookContact[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(ADDRESS_BOOK_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => item?.nickname && item?.address) : [];
  } catch {
    return [];
  }
}

function saveContacts(contacts: AddressBookContact[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(ADDRESS_BOOK_KEY, JSON.stringify(contacts));
}

interface SendPaymentFormProps {
  fromPublicKey: string;
}

export default function SendPaymentForm({ fromPublicKey }: SendPaymentFormProps) {
  const [asset, setAsset]         = useState<Asset>("XLM");
  const [recipient, setRecipient] = useState("");
  const [contacts, setContacts] = useState<AddressBookContact[]>([]);
  const [contactNickname, setContactNickname] = useState("");
  const [lastRecipient, setLastRecipient] = useState("");
  const [amount, setAmount]       = useState("");
  const [memo, setMemo]           = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [txHash, setTxHash]         = useState<string | null>(null);
  const [error, setError]           = useState<string | null>(null);

  useEffect(() => {
    setContacts(loadContacts());
  }, []);

  const recipientValid = isValidStellarAddress(recipient);
  const matchingContacts = useMemo(() => {
    const query = recipient.trim().toLowerCase();
    if (!query) return contacts.slice(0, 5);
    return contacts
      .filter((contact) =>
        contact.nickname.toLowerCase().includes(query) ||
        contact.address.toLowerCase().includes(query),
      )
      .slice(0, 5);
  }, [contacts, recipient]);

  const addContact = (address: string, nickname: string) => {
    const cleanAddress = address.trim();
    const cleanNickname = nickname.trim();
    if (!cleanNickname || !isValidStellarAddress(cleanAddress)) return;
    const next = [
      { nickname: cleanNickname, address: cleanAddress },
      ...contacts.filter((contact) => contact.address !== cleanAddress),
    ];
    setContacts(next);
    saveContacts(next);
    setContactNickname("");
  };

  const handleSend = async () => {
    setError(null);
    setTxHash(null);

    if (!recipientValid) { setError("Invalid Stellar address."); return; }
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) { setError("Enter a valid amount greater than 0."); return; }

    setSubmitting(true);
    try {
      const tx = await buildPaymentTransaction({
        fromPublicKey,
        toPublicKey: recipient.trim(),
        amount: parsed.toFixed(7),
        memo: memo.trim() || undefined,
        asset,
      });

      const { signedXDR, error: signError } = await signTransactionWithWallet(tx.toXDR());
      if (signError || !signedXDR) throw new Error(signError || "Signing cancelled.");

      const result = await submitTransaction(signedXDR);
      setTxHash((result as any).hash ?? null);
      setLastRecipient(recipient.trim());
      setRecipient("");
      setAmount("");
      setMemo("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Payment failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card border-market-500/20">
      <h3 className="font-display text-base font-semibold text-amber-100 mb-4">Send Payment</h3>

      {/* Asset selector */}
      <div className="flex gap-2 mb-4">
        {(["XLM", "USDC"] as Asset[]).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAsset(a)}
            className={clsx(
              "px-4 py-1.5 rounded-full text-sm font-medium border transition-all",
              asset === a
                ? "bg-market-500/15 text-market-300 border-market-500/30"
                : "text-amber-700 border-market-500/10 hover:border-market-500/25"
            )}
          >
            {a}
          </button>
        ))}
      </div>

      {/* Recipient */}
      <label className="label block mb-1">Recipient address</label>
      <input
        type="text"
        list="address-book-contacts"
        value={recipient}
        onChange={(e) => setRecipient(e.target.value.trim())}
        placeholder="G…"
        className={clsx(
          "w-full bg-ink-800 border rounded-xl px-4 py-2.5 text-sm text-amber-100 placeholder-amber-900 focus:outline-none mb-1",
          recipient && !recipientValid
            ? "border-red-500/40 focus:border-red-500/60"
            : "border-market-500/15 focus:border-market-500/40"
        )}
      />
      <datalist id="address-book-contacts">
        {contacts.map((contact) => (
          <option key={contact.address} value={contact.address}>
            {contact.nickname}
          </option>
        ))}
      </datalist>
      {matchingContacts.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {matchingContacts.map((contact) => (
            <button
              key={contact.address}
              type="button"
              onClick={() => setRecipient(contact.address)}
              className="text-xs rounded-full border border-market-500/20 bg-market-500/8 px-2.5 py-1 text-market-300 hover:bg-market-500/15"
            >
              {contact.nickname}
            </button>
          ))}
        </div>
      )}
      {recipient && !recipientValid && (
        <p className="text-xs text-red-400 mb-3">Not a valid Stellar address</p>
      )}

      {/* Amount */}
      <label className="label block mt-3 mb-1">Amount ({asset})</label>
      <input
        type="number"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="0.0000000"
        min="0"
        step="0.0000001"
        className="w-full bg-ink-800 border border-market-500/15 rounded-xl px-4 py-2.5 text-sm text-amber-100 placeholder-amber-900 focus:outline-none focus:border-market-500/40 mb-3"
      />

      {/* Memo */}
      <label className="label block mb-1">Memo <span className="text-amber-900 font-normal">(optional)</span></label>
      <input
        type="text"
        value={memo}
        onChange={(e) => setMemo(e.target.value.slice(0, 28))}
        placeholder="Up to 28 characters"
        className="w-full bg-ink-800 border border-market-500/15 rounded-xl px-4 py-2.5 text-sm text-amber-100 placeholder-amber-900 focus:outline-none focus:border-market-500/40 mb-4"
      />

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {txHash && (
        <div className="mb-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm space-y-3">
          <p>
            ✅ Sent!{" "}
            <a href={explorerUrl(txHash)} target="_blank" rel="noopener noreferrer" className="underline hover:text-emerald-300">
              View on Stellar Expert ↗
            </a>
          </p>
          {lastRecipient && !contacts.some((contact) => contact.address === lastRecipient) && (
            <div className="rounded-lg border border-emerald-500/20 bg-ink-900/50 p-3">
              <p className="text-xs text-emerald-200 mb-2">Add this recipient to your address book?</p>
              <div className="flex gap-2">
                <input
                  value={contactNickname}
                  onChange={(e) => setContactNickname(e.target.value)}
                  placeholder="Nickname"
                  className="flex-1 bg-ink-800 border border-market-500/15 rounded-lg px-3 py-2 text-xs text-amber-100"
                />
                <button
                  type="button"
                  onClick={() => addContact(lastRecipient, contactNickname)}
                  disabled={!contactNickname.trim()}
                  className="btn-secondary text-xs px-3 py-2 disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <button
        onClick={handleSend}
        disabled={submitting || !recipient || !amount}
        className="btn-primary text-sm py-2.5 px-6 w-full disabled:opacity-50"
      >
        {submitting ? "Sending…" : `Send ${asset}`}
      </button>
    </div>
  );
}
