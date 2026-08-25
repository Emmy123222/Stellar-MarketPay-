import "reflect-metadata";
import { UserPreference } from "./entities/UserPreference";
import { NotificationLog } from "./entities/NotificationLog";
import { DataSource } from "typeorm";
import { config } from "../config";
import { logger } from "../utils/logger";
import { Booking } from "./entities/Booking";
import { Flight } from "./entities/Flight";
import { Passenger } from "./entities/Passenger";
import { IdempotencyKey } from "./entities/IdempotencyKey";
import { AdminUser } from "./entities/AdminUser";
import { AdminAuditLog } from "./entities/AdminAuditLog";
import { Refund } from "./entities/Refund";
import { User } from "./entities/User";
import { TravelDocument } from "./entities/TravelDocument";
import { Tenant } from "./entities/Tenant";
import { DashboardShare } from "./entities/DashboardShare";
import { DashboardComment } from "./entities/DashboardComment";
import { AnalyticsAuditLog } from "./entities/AnalyticsAuditLog";
import { ContractEventLog } from "./entities/ContractEventLog";
import { InsurancePolicy } from "./entities/InsurancePolicy";
import { InsuranceClaim } from "./entities/InsuranceClaim";
import { CheckIn } from "./entities/CheckIn";
import { BiometricCredential } from "./entities/BiometricCredential";
import { SearchHistoryEntry } from "./entities/SearchHistoryEntry";
import { SavedSearch } from "./entities/SavedSearch";
import { UserProfile } from "./entities/UserProfile";
import { AccountDeletionRequest } from "./entities/AccountDeletionRequest";
import { Dispute } from "./entities/Dispute";
import { DisputeEvidence } from "./entities/DisputeEvidence";
import { RecommendationEvent } from "./entities/RecommendationEvent";
import { Review } from "./entities/Review";
import { Feedback } from "./entities/Feedback";
import { FeedbackVote } from "./entities/FeedbackVote";
import { CarbonOffset } from "./entities/CarbonOffset";
import { OffsetProject } from "./entities/OffsetProject";
import { TrackedFlight } from "./entities/TrackedFlight";
import { PriceObservation } from "./entities/PriceObservation";
import { Message } from "./entities/Message";

const isTest = process.env.NODE_ENV === "test";

export const AppDataSource = new DataSource(
  isTest
    ? {
      type: "better-sqlite3",
      database: ":memory:",
      dropSchema: true,
      synchronize: true,
      entities: [
        Booking,
        Flight,
        Passenger,
        IdempotencyKey,
        UserPreference,
        NotificationLog,
        AdminUser,
        AdminAuditLog,
        Refund,
        User,
        TravelDocument,
        Tenant,
        DashboardShare,
        DashboardComment,
        AnalyticsAuditLog,
        ContractEventLog,
        InsurancePolicy,
        InsuranceClaim,
        CheckIn,
        BiometricCredential,
        SearchHistoryEntry,
        SavedSearch,
        UserProfile,
        AccountDeletionRequest,
        Dispute,
        DisputeEvidence,
        RecommendationEvent,
        Review,
        Feedback,
        FeedbackVote,
        CarbonOffset,
        OffsetProject,
        TrackedFlight,
        PriceObservation,
        Message,
      ],
      logging: false,
    }
    : {
      type: "postgres",
      url: config.databaseUrl,
      synchronize: false,
      logging: false,
      entities: [
        Booking,
        Flight,
        Passenger,
        IdempotencyKey,
        UserPreference,
        NotificationLog,
        AdminUser,
        AdminAuditLog,
        Refund,
        User,
        TravelDocument,
        Tenant,
        DashboardShare,
        DashboardComment,
        AnalyticsAuditLog,
        ContractEventLog,
        InsurancePolicy,
        InsuranceClaim,
        CheckIn,
        BiometricCredential,
        SearchHistoryEntry,
        SavedSearch,
        UserProfile,
        AccountDeletionRequest,
        Dispute,
        DisputeEvidence,
        RecommendationEvent,
        Review,
        Feedback,
        FeedbackVote,
        CarbonOffset,
        OffsetProject,
        TrackedFlight,
        PriceObservation,
        Message,
      ],
      migrations: [__dirname + "/migrations/*.{js,ts}"],
      ssl:
        config.environment === "production"
          ? { rejectUnauthorized: false }
          : false,
    },
);

export const initDataSource = async () => {
  if (AppDataSource.isInitialized) return;

  // In test mode use the in-memory SQLite datasource — no DATABASE_URL needed
  if (isTest) {
    await AppDataSource.initialize();
    return;
  }

  // If no database URL is configured (dev without Postgres), skip initialization
  if (!config.databaseUrl) {
    logger.warn(
      "No Postgres DATABASE_URL provided, skipping TypeORM datasource initialization",
    );
    return;
  }

  await AppDataSource.initialize();

  try {
    logger.info("Checking database migrations...");
    const hasPending = await AppDataSource.showMigrations();
    if (hasPending) {
      logger.info("Pending migrations found. Running migrations...");
      const runMigrations = await AppDataSource.runMigrations();
      logger.info(`Successfully executed ${runMigrations.length} migrations.`);
    } else {
      logger.info("Database schema is up to date.");
    }
  } catch (error) {
    logger.error("Failed to run database migrations on startup:", error as Error);
    throw error;
  }
};
