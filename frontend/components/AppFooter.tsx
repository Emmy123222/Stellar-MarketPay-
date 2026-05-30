interface AppFooterProps {
  onOpenShortcuts: () => void;
}

export default function AppFooter({ onOpenShortcuts }: AppFooterProps) {
  return (
    <footer className="border-t border-market-500/10 dark:border-market-500/5 py-6 text-center">
      <p className="text-amber-900 dark:text-amber-800 text-sm font-body">
        Open source · MIT License ·{" "}
        <button
          type="button"
          onClick={onOpenShortcuts}
          className="text-market-400 hover:text-market-300 underline underline-offset-2"
        >
          Shortcuts
        </button>
      </p>
    </footer>
  );
}
