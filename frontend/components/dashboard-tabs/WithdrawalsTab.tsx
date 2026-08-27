/**
 * components/dashboard-tabs/WithdrawalsTab.tsx
 * Tab for viewing withdrawal history
 */
import StateMessage from "@/components/StateMessage";

export interface WithdrawalEntry {
  id: string;
  amount: string;
  asset: string;
  fiatCurrency: string;
}

interface Props {
  withdrawHistory: WithdrawalEntry[];
  onWithdraw: () => void;
}

export default function WithdrawalsTab({ withdrawHistory, onWithdraw }: Props) {
  if (withdrawHistory.length === 0) {
    return (
      <StateMessage
        type="empty"
        title="No withdrawals yet"
        description="Add a withdrawal to move funds to your bank account"
        ctaLabel="Withdraw now"
        onCta={onWithdraw}
      />
    );
  }

  return (
    <div className="space-y-3">
      {withdrawHistory.map((entry) => (
        <div key={entry.id} className="card">
          <p className="font-display font-semibold text-amber-100">
            {entry.amount} {entry.asset} → {entry.fiatCurrency}
          </p>
        </div>
      ))}
    </div>
  );
}
