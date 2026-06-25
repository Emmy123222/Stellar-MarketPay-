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
  setJwtToken: jest.fn(),
  fetchPasskeyRegistrationOptions: jest.fn().mockResolvedValue({ challenge: "abc" }),
  fetchPasskeyCredentials: jest.fn().mockResolvedValue([]),
  verifyPasskeyRegistration: jest.fn().mockResolvedValue({}),
  deletePasskeyCredential: jest.fn().mockResolvedValue({}),
}));

jest.mock("@/lib/stellar", () => ({
  createEscrowOnChain: jest.fn().mockResolvedValue({ txHash: "tx-hash", jobId: "job-1" }),
  isFreighterInstalled: jest.fn().mockResolvedValue(true),
  connectWallet: jest.fn().mockResolvedValue("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"),
  performSEP0010Auth: jest.fn().mockResolvedValue("jwt-token"),
  getXLMBalance: jest.fn().mockResolvedValue("1000"),
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
}));

jest.mock("@/lib/sorobanFees", () => ({
  estimateSorobanFee: jest.fn().mockResolvedValue({ fee: "100", resourceFee: "50" }),
  describeContractCall: jest.fn().mockReturnValue("create_escrow"),
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
