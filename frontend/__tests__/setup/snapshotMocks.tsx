jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

// ─── Heavy dashboard / form component stubs ───────────────────────────────────
// Prevents deep render trees from pulling in components that need their own
// complex mocks.  Each stub renders a single, stable element with a data-testid
// so snapshots remain meaningful without blowing up on sub-tree dependencies.

jest.mock("@/components/WalletConnect", () => ({
  __esModule: true,
  default: () => <div data-testid="wallet-connect-stub" />,
}));

jest.mock("@/components/EditProfileForm", () => ({
  __esModule: true,
  default: () => <div data-testid="edit-profile-form-stub" />,
}));

jest.mock("@/components/SendPaymentForm", () => ({
  __esModule: true,
  default: () => <div data-testid="send-payment-form-stub" />,
}));

jest.mock("@/components/PostJobForm", () => ({
  __esModule: true,
  default: ({ publicKey }: { publicKey: string }) => (
    <div data-testid="post-job-form-stub" data-public-key={publicKey} />
  ),
}));

jest.mock("@/components/JobTimeline", () => ({
  __esModule: true,
  default: () => <div data-testid="job-timeline-stub" />,
}));

jest.mock("@/components/BulkJobActionBar", () => ({
  __esModule: true,
  default: () => <div data-testid="bulk-job-action-bar-stub" />,
}));

jest.mock("@/components/JobStatusTimeline", () => ({
  __esModule: true,
  default: () => <div data-testid="job-status-timeline-stub" />,
}));

jest.mock("@/components/ExtendJobModal", () => ({
  __esModule: true,
  default: () => <div data-testid="extend-job-modal-stub" />,
}));

jest.mock("@/components/ClientSpendingTab", () => ({
  __esModule: true,
  default: () => <div data-testid="client-spending-tab-stub" />,
}));

jest.mock("@/components/EarningsChart", () => ({
  __esModule: true,
  default: () => <div data-testid="earnings-chart-stub" />,
}));

jest.mock("@/components/TimeTracker", () => ({
  __esModule: true,
  default: () => <div data-testid="time-tracker-stub" />,
}));

jest.mock("@/components/dashboard-tabs/PostedJobsTab", () => ({
  __esModule: true,
  default: () => <div data-testid="posted-jobs-tab-stub" />,
}));

jest.mock("@/components/dashboard-tabs/AppliedJobsTab", () => ({
  __esModule: true,
  default: () => <div data-testid="applied-jobs-tab-stub" />,
}));

jest.mock("@/components/dashboard-tabs/InvitationsTab", () => ({
  __esModule: true,
  default: () => <div data-testid="invitations-tab-stub" />,
}));

jest.mock("@/components/ProfileCompletenessWidget", () => ({
  __esModule: true,
  default: () => <div data-testid="profile-completeness-widget-stub" />,
}));

jest.mock("@/components/XlmPriceWidget", () => ({
  __esModule: true,
  default: () => <div data-testid="xlm-price-widget-stub" />,
}));

jest.mock("@/components/StateMessage", () => ({
  __esModule: true,
  default: ({ title, message }: { title?: string; message?: string }) => (
    <div data-testid="state-message-stub">{title || message}</div>
  ),
}));

jest.mock("@/components/BuyXLMModal", () => ({
  __esModule: true,
  default: () => <div data-testid="buy-xlm-modal-stub" />,
}));

jest.mock("@/components/WithdrawToBankModal", () => ({
  __esModule: true,
  default: () => <div data-testid="withdraw-to-bank-modal-stub" />,
}));

jest.mock("@/hooks/useBookmarks", () => ({
  useBookmarks: () => ({
    isSaved: (jobId: string) => jobId === "job-bookmarked",
    toggleBookmark: jest.fn(),
    savedCount: 1,
    getSavedJobs: jest.fn(),
    bookmarks: ["job-bookmarked"],
  }),
}));

jest.mock("@/contexts/PriceContext", () => ({
  usePriceContext: () => ({
    xlmPriceUsd: 0.12,
    priceLoading: false,
    currencyMode: "XLM",
    setCurrencyMode: jest.fn(),
  }),
  PriceProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@/lib/i18n", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", changeLanguage: jest.fn() },
    ready: true,
  }),
}));

jest.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="recharts-container">{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  PieChart: ({ children }: { children: React.ReactNode }) => <div data-testid="pie-chart">{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
  Pie: () => null,
  Cell: () => null,
}));

jest.mock("react-chartjs-2", () => ({
  Line: () => <div data-testid="chart-line" />,
  Bar: () => <div data-testid="chart-bar" />,
  Doughnut: () => <div data-testid="chart-doughnut" />,
}));

jest.mock("chart.js", () => ({
  Chart: { register: jest.fn() },
  CategoryScale: jest.fn(),
  LinearScale: jest.fn(),
  PointElement: jest.fn(),
  LineElement: jest.fn(),
  BarElement: jest.fn(),
  ArcElement: jest.fn(),
  Title: jest.fn(),
  Tooltip: jest.fn(),
  Legend: jest.fn(),
  Filler: jest.fn(),
}));

jest.mock("qrcode.react", () => ({
  QRCodeSVG: () => <svg data-testid="qr-code" />,
}));

jest.mock("@/components/Toast", () => {
  const actual = jest.requireActual("@/components/Toast");
  return {
    ...actual,
    useToast: () => ({
      success: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
    }),
  };
});

jest.mock("@/lib/api", () => ({
  fetchCategories: jest.fn().mockResolvedValue([]),
  submitRating: jest.fn().mockResolvedValue({}),
  submitApplication: jest.fn().mockResolvedValue({}),
  fetchProposalTemplates: jest.fn().mockResolvedValue([]),
  fetchProfile: jest.fn().mockResolvedValue({
    publicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    role: "freelancer",
    displayName: "Jane Doe",
    bio: "Stellar developer",
    skills: ["React"],
    completedJobs: 2,
    totalEarnedXLM: "100",
    rating: 4.5,
    tier: "Top Rated",
    availability: { status: "available" },
    portfolioItems: [],
    createdAt: "2025-06-01T00:00:00.000Z",
  }),
  upsertProfile: jest.fn().mockResolvedValue({}),
  updateProfileAvailability: jest.fn().mockResolvedValue({}),
  uploadPortfolioFiles: jest.fn().mockResolvedValue([]),
  fetchAdminMetrics: jest.fn().mockResolvedValue({
    period: "30d",
    platformHealth: {
      total_jobs: 10,
      open_jobs: 4,
      completed_jobs: 5,
      disputed_jobs: 1,
      completion_rate: 80,
      dispute_rate: 10,
    },
    userGrowth: { total_users: 20, freelancers: 12, clients: 8, new_users_period: 3 },
    weeklyGrowth: [{ week: "2026-01-01T00:00:00.000Z", new_users: 2 }],
    financialMetrics: {
      total_xlm_escrow: 1000,
      total_xlm_released: 500,
      avg_job_budget: 200,
      active_escrows: 3,
    },
    qualityMetrics: { avg_rating: 4.5, total_ratings: 12, repeat_hires: 2 },
    disputeMetrics: [{ week: "2026-01-01T00:00:00.000Z", disputes_opened: 1, disputes_resolved: 0 }],
    topEarners: [],
    jobVolume: [{ date: "2026-01-10T00:00:00.000Z", jobs_created: 3, jobs_completed: 2 }],
  }),
  fetchJobAnalytics: jest.fn().mockResolvedValue({
    jobId: "job-1",
    title: "Build a Soroban escrow contract for marketplace payouts",
    applicantCount: 3,
    averageBid: "90",
    minBid: "80",
    maxBid: "100",
    views: 12,
    applications: [],
    applicationsPerDay: [{ day: "2026-01-10", count: 2 }],
    averageBidAmount: [{ currency: "XLM", avgBid: 90, count: 3 }],
    applicationStatusCounts: { pending: 2, accepted: 1 },
    skillDistribution: { React: 2, TypeScript: 1 },
    daysToHire: null,
  }),
  extendJobExpiry: jest.fn().mockResolvedValue({}),
  fetchMessages: jest.fn().mockResolvedValue([]),
  sendMessage: jest.fn().mockResolvedValue({}),
  attachMessageTxHash: jest.fn().mockResolvedValue({}),
  fetchNotifications: jest.fn().mockResolvedValue({
    notifications: [],
    unreadCount: 0,
    nextCursor: null,
  }),
  markNotificationRead: jest.fn().mockResolvedValue({}),
  markAllNotificationsRead: jest.fn().mockResolvedValue({ updatedCount: 0 }),
  fetchReferralStats: jest.fn().mockResolvedValue({
    totalReferrals: 0,
    paidReferrals: 0,
    pendingReferrals: 0,
    totalEarnedXlm: "0",
    bonusBps: 200,
    referees: [],
    payouts: [],
  }),
  fetchTimeEntries: jest.fn().mockResolvedValue([]),
  fetchTimeInvoices: jest.fn().mockResolvedValue([]),
  logTimeEntry: jest.fn().mockResolvedValue({}),
  generateTimeInvoice: jest.fn().mockResolvedValue({}),
  reviewTimeInvoice: jest.fn().mockResolvedValue({}),
  fetchFreelancerEarnings: jest.fn().mockResolvedValue({
    totalXlm: "250.0000000",
    payments: [
      {
        id: "p-1",
        jobId: "job-1",
        jobTitle: "Build escrow contract",
        amountXlm: "250.0000000",
        releasedAt: "2026-01-10T00:00:00.000Z",
        clientAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      },
    ],
    monthly: [{ month: "2026-01", totalXlm: 250 }],
  }),
  fetchXlmPriceHistory: jest.fn().mockResolvedValue({
    points: [{ timestamp: 1700000000000, priceUsd: 0.12 }],
    currentPriceUsd: 0.12,
    change24hPercent: 1.2,
  }),
  getFaucetStatus: jest.fn().mockResolvedValue({ enabled: true }),
  fundTestnetWallet: jest.fn().mockResolvedValue({ success: true, fundedAmount: "10000" }),
  checkAccountNeedsFunding: jest.fn().mockResolvedValue(true),
  setupAdmin2FA: jest.fn().mockResolvedValue({ qrCode: "otpauth://test", secret: "SECRET" }),
  verifyAdmin2FA: jest.fn().mockResolvedValue({ success: true }),
  fetchPasskeyRegistrationOptions: jest.fn().mockResolvedValue({ challenge: "abc" }),
  fetchPasskeyCredentials: jest.fn().mockResolvedValue([]),
  verifyPasskeyRegistration: jest.fn().mockResolvedValue({}),
  deletePasskeyCredential: jest.fn().mockResolvedValue({}),
  // ── Onboarding ────────────────────────────────────────────────────────────
  syncOnboardingProgress: jest.fn().mockResolvedValue({}),
  // ── Extra API calls used in dashboard ────────────────────────────────────
  fetchClientSpendingAnalytics: jest.fn().mockResolvedValue({
    hasCompletedJobs: false,
    totalSpentXlm: "0",
    jobsBreakdown: { posted: 0, completed: 0, cancelled: 0, inProgress: 0 },
    averageBudgetXlm: "0",
    averagePaidXlm: "0",
    topFreelancers: [],
  }),
  fetchPriceAlertPreference: jest.fn().mockResolvedValue(null),
  upsertPriceAlertPreference: jest.fn().mockResolvedValue({}),
  fetchSavedSearches: jest.fn().mockResolvedValue([]),
  updateSavedSearch: jest.fn().mockResolvedValue({}),
  deleteSavedSearch: jest.fn().mockResolvedValue({}),
  createProposalTemplate: jest.fn().mockResolvedValue({ id: "tpl-1", name: "", content: "" }),
  updateProposalTemplate: jest.fn().mockResolvedValue({ id: "tpl-1", name: "", content: "" }),
  deleteProposalTemplate: jest.fn().mockResolvedValue({}),
}));

jest.mock("@/lib/stellar", () => ({
  createEscrowOnChain: jest.fn().mockResolvedValue({ txHash: "tx-hash", jobId: "job-1" }),
  isFreighterInstalled: jest.fn().mockResolvedValue(true),
  connectWallet: jest.fn().mockResolvedValue("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"),
  performSEP0010Auth: jest.fn().mockResolvedValue("jwt-token"),
  getXLMBalance: jest.fn().mockResolvedValue("1000"),
  getUSDCBalance: jest.fn().mockResolvedValue("0"),
  streamAccountTransactions: jest.fn().mockReturnValue(() => {}),
  publishMessageOnChain: jest.fn().mockResolvedValue("tx-hash"),
  accountUrl: jest.fn((key: string) => `https://stellar.expert/explorer/testnet/account/${key}`),
  isValidStellarAddress: jest.fn((address: string) => /^G[A-Z0-9]{55}$/.test(address)),
  buildPaymentTransaction: jest.fn(),
  signTransactionWithWallet: jest.fn(),
}));

jest.mock("@/lib/wallet", () => ({
  isFreighterInstalled: jest.fn().mockResolvedValue(true),
  connectWallet: jest.fn().mockResolvedValue("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"),
  performSEP0010Auth: jest.fn().mockResolvedValue("jwt-token"),
  getConnectedPublicKey: jest.fn().mockResolvedValue(null),
  subscribeToAccountChanges: jest.fn().mockReturnValue(() => {}),
  signTransactionWithWallet: jest.fn().mockResolvedValue({ signedXDR: "MOCK_XDR", error: null }),
}));

jest.mock("@/lib/sorobanFees", () => ({
  estimateSorobanFee: jest.fn().mockResolvedValue({
    totalStroops: BigInt(2500000),
    totalXlm: "0.2500000",
    totalUsd: 0.0375,
    resourceFeeStroops: BigInt(1500000),
    inclusionFeeStroops: BigInt(1000000),
  }),
  describeContractCall: jest.fn().mockReturnValue("create_escrow"),
  stroopsToXlm: jest.fn().mockReturnValue("0.0100000"),
  calculateMaxFee: jest.fn().mockReturnValue(BigInt(5000000)),
}));

jest.mock("@/lib/anchors", () => ({
  fetchAnchorEndpoints: jest.fn().mockResolvedValue({
    TRANSFER_SERVER: "https://anchor.example/transfer",
    WEB_AUTH_ENDPOINT: "https://anchor.example/auth",
    KYC_SERVER: "https://anchor.example/kyc",
  }),
  startInteractiveDeposit: jest.fn().mockResolvedValue({ url: "https://anchor.example/deposit" }),
  startInteractiveWithdraw: jest.fn().mockResolvedValue({ url: "https://anchor.example/withdraw" }),
  getAnchorJwt: jest.fn().mockResolvedValue("jwt"),
  fetchAnchorTransaction: jest.fn(),
  pollAnchorTransaction: jest.fn(),
}));
