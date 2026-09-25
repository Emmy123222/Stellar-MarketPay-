/**
 * components/dashboard-tabs/PriceAlertsTab.tsx
 * Tab for configuring XLM price alerts
 */
import StateMessage from "@/components/StateMessage";

interface Props {
  minPrice: string;
  maxPrice: string;
  emailEnabled: boolean;
  alertEmail: string;
  onMinPriceChange: (value: string) => void;
  onMaxPriceChange: (value: string) => void;
  onEmailEnabledChange: (value: boolean) => void;
  onAlertEmailChange: (value: string) => void;
  onSave: () => void;
}

export default function PriceAlertsTab({
  minPrice,
  maxPrice,
  emailEnabled,
  alertEmail,
  onMinPriceChange,
  onMaxPriceChange,
  onEmailEnabledChange,
  onAlertEmailChange,
  onSave,
}: Props) {
  if (!minPrice && !maxPrice && !emailEnabled) {
    return (
      <StateMessage
        type="empty"
        title="No price alerts set"
        description="Configure alerts to stay informed about XLM price changes"
        ctaLabel="Add Alert"
        onCta={onSave}
      />
    );
  }

  return (
    <div className="card space-y-4 max-w-lg">
      <input
        type="number"
        value={minPrice}
        onChange={(e) => onMinPriceChange(e.target.value)}
        className="input-field"
        placeholder="Alert if XLM drops below (USD)"
      />
      <input
        type="number"
        value={maxPrice}
        onChange={(e) => onMaxPriceChange(e.target.value)}
        className="input-field"
        placeholder="Alert if XLM rises above (USD)"
      />
      <label className="flex items-center gap-2 text-sm text-amber-200">
        <input
          type="checkbox"
          checked={emailEnabled}
          onChange={(e) => onEmailEnabledChange(e.target.checked)}
        />
        Enable email notifications
      </label>
      {emailEnabled && (
        <input
          value={alertEmail}
          onChange={(e) => onAlertEmailChange(e.target.value)}
          className="input-field"
          placeholder="Email address"
        />
      )}
      <button className="btn-primary text-sm" onClick={onSave}>
        Save Alerts
      </button>
    </div>
  );
}
