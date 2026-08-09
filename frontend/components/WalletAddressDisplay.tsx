/**
 * components/WalletAddressDisplay.tsx
 *
 * Displays the connected wallet address. Renders the provided children when
 * given (Navbar passes balance/address content); otherwise renders a
 * shortened copy of the address.
 */
import { shortenAddress } from "@/utils/format";

interface WalletAddressDisplayProps {
  address: string;
  className?: string;
  title?: string;
  truncatedChars?: number;
  children?: React.ReactNode;
}

export default function WalletAddressDisplay({
  address,
  className,
  title,
  truncatedChars = 6,
  children,
}: WalletAddressDisplayProps) {
  return (
    <div className={className} title={title}>
      {children ?? <span>{shortenAddress(address, truncatedChars)}</span>}
    </div>
  );
}